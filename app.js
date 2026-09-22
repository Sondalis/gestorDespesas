"use strict";

const STORAGE_KEY = 'sondalis_diarias_v1';

(function () {
  const RETENTION_DAYS = 60;

  const MEALS = [
    { key: 'pa',  label: 'Pequeno-almoço' },
    { key: 'alm', label: 'Almoço' },
    { key: 'jan', label: 'Jantar' },
  ];

  const DEFAULT_VALUES = {
    ajudante: { pa: 4,  alm: 15, jan: 17 },
    oficial:  { pa: 6,  alm: 17, jan: 18 },
  };

  const DEFAULT_OFICIAIS = [
    'AMANDEEP SINGH BUTTAR', 'DANILO RODOLFO SOARES BRANCO', 'EULER EDUARDO AMARO ERCULANO',
    'HELDER DUARTE PEDRO', 'HENRIQUE RAINHO MOTEIRO', 'HUMBERTO RICARDO PEREIRA DE SOUSA',
    'JEFFERSON DOS SANTOS JORGE', 'JEKSON DE OLIVEIRA PREUSS', 'JOHNNY BRITO SOARES',
    'JORGE HUMBERTO FIGUEIRA RAMOS', 'JOSE GREGORIO LIRA SISO', 'JOSE MANUEL DO CARMO DA CUNHA',
    'LEANDRO GOMES MARTINS', 'MANUEL DUARTE AGOSTINHO', 'NELSON LOPES BAPTISTA DE SOUSA',
    'NELSON MANUEL LOPES FERREIRA', 'OSCAR DUARTE BRAS', 'PAULO ANDRE DIAS CORREIA',
    'RENATO RAFAEL GOMES MARTINS', 'RUI MIGUEL BOIÇA DAS NEVES', 'SUKHJIT SINGH',
  ];

  const RETURN_NOTHING_BEFORE = 6 * 60;
  const RETURN_LUNCH_FROM = 13 * 60 + 30;

  const KIND_LABEL = {
    partida: 'Dia de partida', intermedio: 'Dia intermédio',
    regresso: 'Dia de regresso', unico: 'Dia único',
  };

  function timeToMinutes(hhmm) {
    if(!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function departureDayMeals(min) {
    if (min <= 6 * 60) {
      return ['alm', 'jan'];
    }
    return ['jan'];
  }

  function intermediateDayMeals() { return ['pa', 'alm', 'jan']; }

  function returnDayMeals(min) {
    if (min < RETURN_NOTHING_BEFORE) return [];
    if (min < RETURN_LUNCH_FROM) return ['pa'];
    return ['pa', 'alm'];
  }

  function calendarDaysInclusive(startDate, endDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function isWeekend(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 || day === 6;
  }

  function getArredondamento(valor) {
      const v = Math.round(valor);
      const rest = Math.abs(v % 10);
      let rounded = v;
      if (rest === 1 || rest === 2 || rest === 3) {
        rounded = v - rest;
      } else if (rest === 4) {
        rounded = v + 1;
      } else if (rest === 6 || rest === 7 || rest === 8) {
        rounded = v - (rest - 5);
      } else if (rest === 9) {
        rounded = v + 1;
      }
      const diff = rounded - v;
      return { original: v, arredondado: rounded, diff: diff };
    }

  function buildTripPlan(saidaData, saidaHora, regressoData, regressoHora, incFimSemana = false) {
    if(!saidaData || !regressoData) return [];
    const totalDays = calendarDaysInclusive(saidaData, regressoData);
    if(totalDays < 1) return [];
    const saidaMin = timeToMinutes(saidaHora);
    const regressoMin = timeToMinutes(regressoHora);

    if (totalDays === 1) {
      if (!incFimSemana && isWeekend(saidaData)) {
        return [{ date: saidaData, kind: 'unico', meals: [], isWeekend: true }];
      }
      const dep = departureDayMeals(saidaMin);
      const ret = returnDayMeals(regressoMin);
      const meals = MEALS.map((m) => m.key).filter((k) => dep.includes(k) && ret.includes(k));
      return [{ date: saidaData, kind: 'unico', meals, isWeekend: isWeekend(saidaData) }];
    }
    const plan = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(saidaData, i);
      const we = isWeekend(date);
      if (!incFimSemana && we) {
        plan.push({ date, kind: (i===0?'partida':(i===totalDays-1?'regresso':'intermedio')), meals: [], isWeekend: true });
        continue;
      }
      if (i === 0) plan.push({ date, kind: 'partida', meals: departureDayMeals(saidaMin), isWeekend: we });
      else if (i === totalDays - 1) plan.push({ date, kind: 'regresso', meals: returnDayMeals(regressoMin), isWeekend: we });
      else plan.push({ date, kind: 'intermedio', meals: intermediateDayMeals(), isWeekend: we });
    }
    return plan;
  }

  function computeTotals(plan, values, tipo) {
    let totalBase = 0, totalDelta = 0;
    for (const day of plan) {
      for (const mealKey of day.meals) {
        const base = values.ajudante[mealKey];
        const person = values[tipo][mealKey];
        totalBase += base;
        if (tipo === 'oficial') totalDelta += person - base;
      }
    }
    const totalBruto = totalBase + totalDelta;
    const arr = getArredondamento(totalBruto);
    return { totalBase,
          totalDelta,
          totalBruto,
          totalGeral: arr.arredondado,
          arredondamento: arr };
  }

  function expurgarRegistosExpirados(registos) {
    if (!registos || !Array.isArray(registos)) return [];
    const hoje = todayISO();
    return registos.filter(r => {
      const dataChegada = r.regressoEfetivoData || r.regressoData;
      if (!dataChegada) return true;
      const dias = calendarDaysInclusive(dataChegada, hoje) - 1;
      return dias <= RETENTION_DAYS;
    });
  }

  const store = {
    state: null,
    load() {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }

      let registosCarregados = (raw && raw.registos) || [];
      registosCarregados = expurgarRegistosExpirados(registosCarregados);

      this.state = {
        values: (raw && raw.values) || clone(DEFAULT_VALUES),
        oficiais: (raw && raw.oficiais) || DEFAULT_OFICIAIS.slice(),
        oficiaisAjudantes: (raw && Array.isArray(raw.oficiaisAjudantes)) ? raw.oficiaisAjudantes : [],
        registos: registosCarregados,
      };
      window.store = store;

      this.state.registos.forEach(r => {
        if (!r.status) {
          r.status = r.concluido ? 'concluido' : 'ativo';
        }
        r.totalOriginal = getArredondamento(r.totalOriginal || 0).arredondado;
        const p = buildTripPlan(r.saidaData, r.saidaHora, r.regressoEfetivoData || r.regressoData, r.regressoEfetivoHora || r.regressoHora, r.incFimSemana);
        const totals = computeTotals(p, this.state.values, r.tipo);
        r.totalGeral = totals.totalGeral;
        r.valorAjuste = r.totalGeral - r.totalOriginal;
      });
    },
    save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        if (typeof window.enviarSync === 'function') {
          window.enviarSync();
        }
      },
    addRegisto(r) { this.state.registos.unshift(r); this.save(); },
    removeRegisto(id) {
      this.state.registos = this.state.registos.filter((r) => r.id !== id);
      this.save();
    },
    findRegisto(id) {
      return this.state.registos.find((x) => x.id === id);
    }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalizeName(s) {
    return String(s || '').trim().toLowerCase();
  }

  function firstWord(s) {
    return normalizeName(s).split(/\s+/)[0] || '';
  }

  function findOverlappingRegisto(nome, saidaData, saidaHora, regressoData, regressoHora, excludeId) {
    const key = normalizeName(nome);
    if (!key || !saidaData || !regressoData) return null;
    const newStart = saidaData + 'T' + (saidaHora || '00:00');
    const newEnd = regressoData + 'T' + (regressoHora || '23:59');
    return store.state.registos.find(r => {
      if (r.id === excludeId) return false;
      const names = [r.nome, r.recebidoPor, r.ajudanteAssoc].filter(Boolean).map(normalizeName);
      if (!names.includes(key)) return false;
      const rStart = r.saidaData + 'T' + (r.saidaHora || '00:00');
      const rEndData = r.regressoEfetivoData || r.regressoData;
      const rEndHora = r.regressoEfetivoHora || r.regressoHora || '23:59';
      const rEnd = rEndData + 'T' + rEndHora;
      return newStart < rEnd && rStart < newEnd;
    }) || null;
  }

  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = curr; curr = tmp;
    }
    return prev[n];
  }

  function getHistoricalNames() {
    const map = new Map();
    (store.state.registos || []).forEach(r => {
      [r.nome, r.recebidoPor, r.ajudanteAssoc].forEach(n => {
        if (!n) return;
        const trimmed = String(n).trim();
        if (!trimmed) return;
        const key = normalizeName(trimmed);
        if (!map.has(key)) map.set(key, trimmed);
      });
    });
    return Array.from(map.values());
  }

  function findFuzzyName(typed) {
    const key = normalizeName(typed);
    if (!key || key.length < 3) return null;
    const maxDist = key.length <= 4 ? 1 : 2;
    let best = null;
    let bestDist = maxDist + 1;
    for (const cand of getHistoricalNames()) {
      const nk = normalizeName(cand);
      if (nk === key) return null;
      const d = levenshtein(nk, key);
      if (d < bestDist) { best = cand; bestDist = d; }
    }
    return best;
  }

  function countRegistosByName(nome) {
    const key = normalizeName(nome);
    if (!key) return 0;
    return (store.state.registos || []).filter(r => {
      return [r.nome, r.recebidoPor, r.ajudanteAssoc].some(n => n && normalizeName(n) === key);
    }).length;
  }

  const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const dateFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  function getMonthKey(dateISO) {
    if (!dateISO) return 'Outros';
    return dateISO.slice(0, 7);
  }
  function getMonthLabel(monthKey) {
    if (monthKey === 'Outros') return 'Outros';
    const [y, m] = monthKey.split('-');
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return (months[parseInt(m, 10) - 1] || '') + ' ' + y;
  }
  function subMeta(obra, ajudante) {
    const bits = [];
    if (obra) bits.push('<span><span class="meta-k">Obra</span>' + esc(obra) + '</span>');
    if (ajudante) bits.push('<span><span class="meta-k">Ajudante</span>' + esc(ajudante) + '</span>');
    return bits.join('');
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  const ui = { tipo: 'ajudante', ultimoCalculo: null, fecharGrupoNome: null, filtroInicio: '', filtroFim: '', filtroTipo: 'todos', viagensAbertas: new Set() };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function init() {
    store.load();
    setDefaultDates();
    wireTabs();
    wireCalcular();
    wireDefinicoes();
    renderOficiaisSelect();
    renderDefinicoes();
    renderPendentes();
    renderRegistos();
  }

  function setDefaultDates() {
    const t = todayISO();
    $('#saidaData').value = t;
    $('#regressoData').value = t;
    $('#saidaHora').value = '06:00';
    $('#regressoHora').value = '19:00';
    if ($('#entreguePorSelect')) $('#entreguePorSelect').value = 'Pendente';
    if ($('#dataEntregaDinheiro')) $('#dataEntregaDinheiro').value = t;
  }

  function wireTabs() {
    $('#tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      $$('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab));
      if (tab === 'pendentes') renderPendentes();
      if (tab === 'registos') renderRegistos();
    });
  }
  function goToTab(tab) {
    $('#tabs button[data-tab="' + tab + '"]').click();
  }

  function wireCalcular() {
    $('#tipoToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tipo]');
      if (!btn) return;
      ui.tipo = btn.dataset.tipo;
      $$('#tipoToggle button').forEach((b) => b.classList.toggle('active', b === btn));
      $('#fieldAjudante').style.display = ui.tipo === 'ajudante' ? '' : 'none';
      $('#fieldOficial').style.display = ui.tipo === 'oficial' ? '' : 'none';
      $('#fieldAjudanteAssoc').style.display = ui.tipo === 'oficial' ? '' : 'none';
    });
    $('#btnCalcular').addEventListener('click', onCalcular);
    $('#btnGuardarRegisto').addEventListener('click', onGuardarRegisto);

    const dismissedSuggestions = new Set();

    function pickSuggestion(raw) {
      const typedKey = normalizeName(raw);
      const typedFirst = firstWord(raw);
      if (!typedFirst) return null;
      const oficialMatches = (store.state.oficiaisAjudantes || []).filter((n) => {
        return firstWord(n) === typedFirst && normalizeName(n) !== typedKey;
      });
      if (oficialMatches.length === 1) return oficialMatches[0];
      return findFuzzyName(raw);
    }

    function refreshHint(inputSel, hintSel) {
      const raw = $(inputSel).value.trim();
      const typedKey = normalizeName(raw);
      const hint = $(hintSel);
      if (!hint) return;
      if (!typedKey || dismissedSuggestions.has(typedKey)) { hint.innerHTML = ''; return; }
      const suggestion = pickSuggestion(raw);
      if (!suggestion || normalizeName(suggestion) === typedKey) { hint.innerHTML = ''; return; }
      hint.innerHTML =
        '<span>É o </span><strong>' + esc(suggestion) + '</strong>?' +
        '<button type="button" class="btn small" data-role="ajudante-sim">Sim</button>' +
        '<button type="button" class="btn ghost small" data-role="ajudante-nao">Não</button>';
      hint.dataset.full = suggestion;
      hint.dataset.typed = typedKey;
      hint.dataset.target = inputSel;
    }

    function bindHint(inputSel, hintSel) {
      $(inputSel).addEventListener('input', () => refreshHint(inputSel, hintSel));
      $(hintSel).addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-role]');
        if (!btn) return;
        const hint = $(hintSel);
        if (btn.dataset.role === 'ajudante-sim' && hint.dataset.full && hint.dataset.target) {
          $(hint.dataset.target).value = hint.dataset.full;
        } else if (btn.dataset.role === 'ajudante-nao' && hint.dataset.typed) {
          dismissedSuggestions.add(hint.dataset.typed);
        }
        hint.innerHTML = '';
      });
    }

    bindHint('#nomeAjudante', '#ajudanteHint');
    bindHint('#ajudanteAssoc', '#ajudanteAssocHint');

    $('#resultado').addEventListener('click', (e) => {
      const chipBtn = e.target.closest('.chip-btn');
      if (chipBtn && ui.ultimoCalculo) {
        const dayIdx = parseInt(chipBtn.dataset.dayIdx, 10);
        const mealKey = chipBtn.dataset.meal;
        const dayPlan = ui.ultimoCalculo.plan[dayIdx];
        if (dayPlan.meals.includes(mealKey)) {
          dayPlan.meals = dayPlan.meals.filter(m => m !== mealKey);
        } else {
          dayPlan.meals.push(mealKey);
        }
        ui.ultimoCalculo.totals = computeTotals(ui.ultimoCalculo.plan, store.state.values, ui.ultimoCalculo.form.tipo);
        renderResultado();
        return;
      }
    });
  }

  function readForm() {
    const nome = ui.tipo === 'oficial' ? $('#nomeOficial').value : $('#nomeAjudante').value.trim();
    return {
      tipo: ui.tipo,
      nome,
      obra: $('#obra').value.trim(),
      ajudanteAssoc: ui.tipo === 'oficial' ? $('#ajudanteAssoc').value.trim() : '',
      saidaData: $('#saidaData').value,
      saidaHora: $('#saidaHora').value,
      regressoData: $('#regressoData').value,
      regressoHora: $('#regressoHora').value,
      entreguePor: $('#entreguePorSelect').value,
      dataEntregaDinheiro: $('#dataEntregaDinheiro').value,
      observacoes: $('#observacoes').value.trim(),
      incFimSemana: $('#incFimSemana').checked,
    };
  }

  function validate(f) {
    const errors = [];
    if (!f.nome) errors.push(f.tipo === 'oficial' ? 'Selecione um oficial.' : 'Escreva o nome do ajudante.');
    if (!f.saidaData || !f.saidaHora) errors.push('Preencha a data e hora de saída.');
    if (!f.regressoData || !f.regressoHora) errors.push('Preencha a data e hora de regresso.');
    if (f.saidaData && f.regressoData) {
      const saida = f.saidaData + 'T' + (f.saidaHora || '00:00');
      const regresso = f.regressoData + 'T' + (f.regressoHora || '00:00');
      if (regresso < saida) errors.push('O regresso não pode ser anterior à saída.');
    }
    if (f.dataEntregaDinheiro && f.dataEntregaDinheiro > todayISO()) {
      errors.push('A data da entrega do dinheiro não pode ser no futuro.');
    }
    return errors;
  }

  function onCalcular() {
    const f = readForm();
    const errors = validate(f);
    if (errors.length) {
      ui.ultimoCalculo = null;
      $('#resultado').innerHTML =
        '<div class="card"><div class="alert err">' +
        errors.map(esc).join('<br>') + '</div></div>';
      return;
    }
    const plan = buildTripPlan(f.saidaData, f.saidaHora, f.regressoData, f.regressoHora, f.incFimSemana);
    const totals = computeTotals(plan, store.state.values, f.tipo);
    ui.ultimoCalculo = { form: f, plan, totals };
    renderResultado();
  }

  function renderResultado() {
    const { form, plan, totals } = ui.ultimoCalculo;
    const rows = plan.map((day, dIdx) => {
      const chips = MEALS.map((m) => {
        const on = day.meals.includes(m.key);
        return '<button type="button" class="chip chip-btn' + (on ? ' on' : '') + '" data-day-idx="' + dIdx + '" data-meal="' + m.key + '">' + m.label + '</button>';
      }).join('');
      const none = day.meals.length === 0 ? '<span class="chip none">' + (day.isWeekend ? 'fim de semana' : 'sem refeições') + '</span>' : '';
      return (
        '<div class="day-row' + (day.isWeekend ? ' weekend' : '') + '">' +
          '<div class="day-label">' +
            '<span class="day-date">' + esc(fmtDate(day.date)) + '</span>' +
            '<span class="day-kind">' + KIND_LABEL[day.kind] + '</span>' +
          '</div>' +
          '<div class="meals">' + chips + none + '</div>' +
        '</div>'
      );
    }).join('');

    const badge = form.tipo === 'oficial'
      ? '<div class="badge-oficial money">+ ' + eur.format(totals.totalDelta) + ' (Oficial) = ' + eur.format(totals.totalBruto) + '</div>'
      : '';

    const meta = subMeta(form.obra, form.ajudanteAssoc);

    const arr = totals.arredondamento || getArredondamento(totals.totalBruto);
    const diffSign = arr.diff > 0 ? '+' : '';

    $('#resultado').innerHTML =
      '<div class="card">' +
        esc(form.nome) + '</h2>' +
        (meta ? '<div class="calc-meta">' + meta + '</div>' : '') +
        '<div class="totals">' +
          '<div class="total-base">' +
            '<span class="k">Base (Ajudante)</span>' +
            '<span class="v money">' + eur.format(totals.totalBase) + '</span>' +
          '</div>' +
          badge +
          '<div class="total-base">' +
            '<span class="k">Arredondamento</span>' +
            '<span class="v money">' + diffSign + arr.diff + '€</span>' +
          '</div>' +
          '<div class="grand">' +
            '<span class="k">Total a entregar</span><br>' +
            '<span class="v money">' + eur.format(totals.totalGeral) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="breakdown">' + rows + '</div>' +
      '</div>';
  }

  function limparFormulario() {
    $('#nomeAjudante').value = '';
    if ($('#nomeOficial').options.length > 0) $('#nomeOficial').selectedIndex = 0;
    $('#ajudanteAssoc').value = '';
    $('#obra').value = '';
    $('#entreguePorSelect').value = 'Pendente';
    $('#observacoes').value = '';
    $('#incFimSemana').checked = false;

    ui.tipo = 'ajudante';
    $$('#tipoToggle button').forEach((b) => b.classList.toggle('active', b.dataset.tipo === 'ajudante'));
    $('#fieldAjudante').style.display = '';
    $('#fieldOficial').style.display = 'none';
    $('#fieldAjudanteAssoc').style.display = 'none';

    setDefaultDates();
    ui.ultimoCalculo = null;
    $('#resultado').innerHTML = '';
  }

  function onGuardarRegisto() {
    onCalcular();
    if (!ui.ultimoCalculo) return;
    const { form, totals } = ui.ultimoCalculo;

    const conflito = findOverlappingRegisto(form.nome, form.saidaData, form.saidaHora, form.regressoData, form.regressoHora, null);
    if (conflito) {
      const inicio = fmtDate(conflito.saidaData) + ' ' + (conflito.saidaHora || '');
      const fim = fmtDate(conflito.regressoEfetivoData || conflito.regressoData) + ' ' + (conflito.regressoEfetivoHora || conflito.regressoHora || '');
      $('#resultado').innerHTML =
        '<div class="card"><div class="alert err">' +
        esc(form.nome) + ' já tem uma viagem que se sobrepõe a este período (' + esc(inicio.trim()) + ' → ' + esc(fim.trim()) + '). Ajuste as datas ou apague a viagem anterior.' +
        '</div></div>';
      return;
    }

    const isPendente = form.entreguePor === 'Pendente';
    const statusDestino = isPendente ? 'pendente' : 'ativo';

    const registo = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7),
      criadoEm: new Date().toISOString(),
      status: statusDestino,
      tipo: form.tipo,
      nome: form.nome,
      obra: form.obra,
      ajudanteAssoc: form.ajudanteAssoc,
      saidaData: form.saidaData,
      saidaHora: form.saidaHora,
      saidaDataInicial: form.saidaData,
      saidaHoraInicial: form.saidaHora,
      regressoData: form.regressoData,
      regressoHora: form.regressoHora,
      regressoDataInicial: form.regressoData,
      regressoHoraInicial: form.regressoHora,
      incFimSemana: form.incFimSemana,

      regressoEfetivoData: form.regressoData,
      regressoEfetivoHora: form.regressoHora,

      totalOriginal: totals.totalGeral,
      totalGeral: totals.totalGeral,
      valorAjuste: 0,

      entreguePor: form.entreguePor,
      dataEntregaDinheiro: statusDestino === 'ativo' ? (form.dataEntregaDinheiro || form.saidaData || todayISO()) : '',
      recebidoPor: form.nome,
      observacoes: form.observacoes || '',
      faturaEntregue: false,

      faturaEntregueA: '',
      dataEntregaFatura: todayISO(),

      concluido: false,
      dataConclusao: null
    };
    store.addRegisto(registo);
    limparFormulario();
    toast('Registado com sucesso');
  }

  /* ============================================================
   *  PENDENTES
   * ============================================================ */
  function renderPendentes() {
    const pendentes = store.state.registos.filter(r => r.status === 'pendente');
    const container = $('#registosPendentes');
    if (!pendentes.length) {
      container.innerHTML = '<p class="section-title">Cálculos Pendentes (0)</p><div class="empty">Nenhum registo pendente.</div>';
      return;
    }
    const html = pendentes.map(recCard).join('');
    container.innerHTML =
      '<p class="section-title">' +
        '<span>Cálculos Pendentes (' + pendentes.length + ')</span>' +
        '<button class="btn accent small" id="btnImprimirTodosPendentes">🖨️ Imprimir todos (' + pendentes.length + ')</button>' +
      '</p>' +
      '<div class="user-content" style="padding:0; background:transparent;">' + html + '</div>';
  }

  function sincronizarCamposPendentesVisiveis() {
    $$('#registosPendentes .rec[data-rid]').forEach((rec) => {
      const registo = store.findRegisto(rec.dataset.rid);
      if (!registo) return;
      const selectEntregue = rec.querySelector('[data-role="entreguePorSelectPendente"]');
      const inputRecebido = rec.querySelector('[data-role="recebidoPorPendente"]');
      const inputData = rec.querySelector('[data-role="dataEntregaDinheiroPendente"]');
      if (selectEntregue) registo.entreguePor = selectEntregue.value;
      if (inputRecebido) registo.recebidoPor = inputRecebido.value.trim();
      if (inputData) registo.dataEntregaDinheiro = inputData.value;
    });
    store.save();
  }

  function abrirImpressaoMiniRecibos(regs, tituloPagina) {
    if (!regs.length) {
      alert('Não há recibos para imprimir.');
      return;
    }
    sincronizarCamposPendentesVisiveis();
    const POR_PAGINA = 8;

    const miniRecibo = (r) => {
      const dataIda = fmtDate(r.saidaData);
      const dataVolta = fmtDate(r.regressoEfetivoData || r.regressoData);
      const dataRecebimento = r.dataEntregaDinheiro ? fmtDate(r.dataEntregaDinheiro) : fmtDate(todayISO());
      const entreguePor = (r.entreguePor && r.entreguePor !== 'Pendente') ? r.entreguePor : '—';
      const recebidoPor = r.recebidoPor || r.nome || '';

      const plan = buildTripPlan(r.saidaData, r.saidaHora, r.regressoEfetivoData || r.regressoData, r.regressoEfetivoHora || r.regressoHora, r.incFimSemana);
      // Recibo assinado pelo trabalhador: mostra sempre o valor de ajudante,
      // mesmo quando o registo é de oficial (o adicional oficial é entregue à parte).
      const valorTotal = computeTotals(plan, store.state.values, 'ajudante').totalGeral;

      return (
        '<div class="mini">' +
          '<div class="mini-head">' +
            '<span class="mini-nome">' + esc(recebidoPor) + '</span>' +
          '</div>' +
          (r.obra ? '<div class="mini-obra">' + esc(r.obra) + '</div>' : '') +
          '<div class="mini-rows">' +
            '<div class="mini-row"><span>Ida</span><span>' + esc(dataIda) + '</span></div>' +
            '<div class="mini-row"><span>Volta</span><span>' + esc(dataVolta) + '</span></div>' +
            '<div class="mini-row"><span>Recebimento</span><span>' + esc(dataRecebimento) + '</span></div>' +
            '<div class="mini-row"><span>Entregue por</span><span>' + esc(entreguePor) + '</span></div>' +
          '</div>' +
          '<div class="mini-valor"><span>Valor</span><span class="v">' + esc(eur.format(valorTotal)) + '</span></div>' +
          '<div class="mini-obs">' +
            '<div class="mini-obs-label">Observações</div>' +
            '<div class="mini-obs-txt">' + esc(r.observacoes || '') + '</div>' +
          '</div>' +
          '<div class="mini-sig">Assinatura</div>' +
        '</div>'
      );
    };

    const paginas = [];
    for (let i = 0; i < regs.length; i += POR_PAGINA) {
      const bloco = regs.slice(i, i + POR_PAGINA).map(miniRecibo).join('');
      paginas.push('<div class="pagina">' + bloco + '</div>');
    }

    const html =
      '<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8">' +
      '<title>' + esc(tituloPagina) + '</title>' +
      '<style>' +
      '  @page { size: A4 portrait; margin: 8mm; }' +
      '  * { box-sizing: border-box; }' +
      '  body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #17211f; margin: 0; padding: 0; }' +
      '  .pagina { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 65mm; gap: 4mm; page-break-after: always; }' +
      '  .pagina:last-child { page-break-after: auto; }' +
      '  .mini { border: 1px solid #17211f; border-radius: 3px; padding: 3mm 3.5mm; display: flex; flex-direction: column; page-break-inside: avoid; overflow: hidden; }' +
      '  .mini-head { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; border-bottom: 1px solid #0f4c4a; padding-bottom: 1.5mm; }' +
      '  .mini-nome { font-size: 10px; font-weight: 700; line-height: 1.2; color: #0a3634; }' +
      '  .mini-obra { font-size: 8px; color: #4a5854; margin-top: 1mm; }' +
      '  .mini-rows { margin-top: 1.5mm; }' +
      '  .mini-row { display: flex; justify-content: space-between; font-size: 8.5px; padding: 0.6mm 0; border-bottom: 1px dotted #c3cabf; }' +
      '  .mini-row span:first-child { color: #4a5854; }' +
      '  .mini-row span:last-child { font-weight: 600; }' +
      '  .mini-valor { margin-top: 1.5mm; display: flex; justify-content: space-between; align-items: center; background: #e3edeb; padding: 1.2mm 2mm; border-radius: 2px; }' +
      '  .mini-valor span:first-child { font-size: 8px; text-transform: uppercase; letter-spacing: .06em; color: #0a3634; font-weight: 700; }' +
      '  .mini-valor .v { font-family: "Consolas", monospace; font-size: 12px; font-weight: 700; color: #0a3634; }' +
      '  .mini-obs { margin-top: 1.5mm; flex: 1 1 auto; min-height: 9mm; overflow: hidden; }' +
      '  .mini-obs-label { font-size: 7px; text-transform: uppercase; letter-spacing: .08em; color: #8a958f; }' +
      '  .mini-obs-txt { font-size: 8px; color: #17211f; white-space: pre-wrap; line-height: 1.25; }' +
      '  .mini-sig { margin-top: 6mm; padding-top: 1mm; border-top: 1px solid #17211f; font-size: 7.5px; color: #8a958f; text-align: center; }' +
      '  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }' +
      '</style></head><body>' +
      paginas.join('') +
      '<script>window.onload = function() { setTimeout(function() { window.print(); }, 150); };<\/script>' +
      '</body></html>';

    const w = window.open('', '_blank');
    if (!w) {
      alert('Ativa os pop-ups para poder imprimir.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function imprimirTodosPendentes() {
    const pendentes = store.state.registos.filter(r => r.status === 'pendente');
    if (!pendentes.length) {
      alert('Não há cálculos pendentes para imprimir.');
      return;
    }
    // Sincroniza os inputs visíveis do tab Pendentes antes de mostrar a validação,
    // para que o modal reflita quem foi selecionado como "Entregue por" / "Recebido por".
    sincronizarCamposPendentesVisiveis();

    selecaoNome = '';
    selecaoModo = 'mini-todos';

    const ordenados = pendentes.slice().sort((a, b) => {
      const na = (a.nome || '').localeCompare(b.nome || '', 'pt');
      if (na !== 0) return na;
      return a.saidaData.localeCompare(b.saidaData);
    });

    const linhas = ordenados.map((r) => {
      const dataRegresso = r.regressoEfetivoData || r.regressoData;
      const plan = buildTripPlan(r.saidaData, r.saidaHora, dataRegresso, r.regressoEfetivoHora || r.regressoHora, r.incFimSemana);
      const total = computeTotals(plan, store.state.values, 'ajudante').totalGeral;
      return (
        '<label class="sel-row">' +
          '<input type="checkbox" data-rid="' + r.id + '" checked>' +
          '<span class="sel-datas"><strong>' + esc(r.nome) + '</strong> — ' + esc(fmtDate(r.saidaData)) + ' → ' + esc(fmtDate(dataRegresso)) + '</span>' +
          '<span class="sel-estado">' + esc(r.entreguePor && r.entreguePor !== 'Pendente' ? r.entreguePor : '—') + '</span>' +
          '<span class="money">' + esc(eur.format(total)) + '</span>' +
        '</label>'
      );
    }).join('');

    $('#selecaoTitulo').textContent = 'Confirmar impressão de recibos';
    $('#selecaoBody').innerHTML =
      '<div class="sel-toolbar">' +
        '<button class="btn ghost small" data-role="sel-todas">Selecionar todos</button>' +
        '<button class="btn ghost small" data-role="sel-nenhuma">Limpar seleção</button>' +
      '</div>' +
      '<div class="sel-mes">Confirme quais recibos quer imprimir</div>' +
      linhas;

    atualizarContagemSelecao();
    $('#selecaoBody').scrollTop = 0;
    $('#selecaoOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  let selecaoNome = '';
  let selecaoModo = 'report'; // 'report' = per-employee monthly report; 'mini-todos' = validar antes de imprimir todos os pendentes

  function abrirSelecaoImpressao(nome, idsPreSelecionados) {
    selecaoNome = nome;
    selecaoModo = 'report';
    const preSel = new Set(idsPreSelecionados || []);

    const viagens = store.state.registos
      .filter(r => r.status !== 'pendente' && r.nome.toUpperCase() === String(nome).toUpperCase())
      .sort((a, b) => b.saidaData.localeCompare(a.saidaData));

    if (!viagens.length) {
      alert('Não há viagens para imprimir.');
      return;
    }

    const meses = {};
    for (const r of viagens) {
      const mKey = getMonthKey(r.saidaData);
      (meses[mKey] = meses[mKey] || []).push(r);
    }

    const corpo = Object.keys(meses).sort().reverse().map((mKey) => {
      const linhas = meses[mKey].map((r) => {
        const dataRegresso = r.regressoEfetivoData || r.regressoData;
        const plan = buildTripPlan(r.saidaData, r.saidaHora, dataRegresso, r.regressoEfetivoHora || r.regressoHora, r.incFimSemana);
        const total = computeTotals(plan, store.state.values, r.tipo).totalGeral;
        const estado = r.concluido ? 'Concluída' : (r.faturaEntregue ? 'Despesa entregue' : 'Por entregar');
        return (
          '<label class="sel-row">' +
            '<input type="checkbox" data-rid="' + r.id + '"' + (preSel.has(r.id) ? ' checked' : '') + '>' +
            '<span class="sel-datas">' + esc(fmtDate(r.saidaData)) + ' — ' + esc(fmtDate(dataRegresso)) + '</span>' +
            '<span class="sel-estado">' + estado + '</span>' +
            '<span class="money">' + esc(eur.format(total)) + '</span>' +
          '</label>'
        );
      }).join('');
      return '<div class="sel-mes">' + esc(getMonthLabel(mKey)) + '</div>' + linhas;
    }).join('');

    $('#selecaoTitulo').textContent = nome;
    $('#selecaoBody').innerHTML =
      '<div class="sel-toolbar">' +
        '<button class="btn ghost small" data-role="sel-todas">Selecionar todas</button>' +
        '<button class="btn ghost small" data-role="sel-nenhuma">Limpar seleção</button>' +
      '</div>' + corpo;

    atualizarContagemSelecao();
    $('#selecaoBody').scrollTop = 0;
    $('#selecaoOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function fecharSelecaoImpressao() {
    const ov = $('#selecaoOverlay');
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    $('#selecaoBody').innerHTML = '';
    document.body.style.overflow = '';
  }

  function idsSelecionados() {
    return $$('#selecaoBody input[type="checkbox"]:checked').map(cb => cb.dataset.rid);
  }

  function atualizarContagemSelecao() {
    const n = idsSelecionados().length;
    const total = $$('#selecaoBody input[type="checkbox"]').length;
    $('#selecaoContagem').textContent = n + ' de ' + total + ' viagem(ns) selecionada(s)';
    $('#btnImprimirSelecao').disabled = (n === 0);
  }

  function wireSelecaoImpressao() {
    const ov = $('#selecaoOverlay');
    if (!ov || ov.dataset.wired) return;
    ov.dataset.wired = '1';

    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('#btnFecharSelecao') || e.target.closest('[data-role="fechar-selecao"]')) {
        fecharSelecaoImpressao();
        return;
      }
      if (e.target.closest('[data-role="sel-todas"]')) {
        $$('#selecaoBody input[type="checkbox"]').forEach(cb => { cb.checked = true; });
        atualizarContagemSelecao();
        return;
      }
      if (e.target.closest('[data-role="sel-nenhuma"]')) {
        $$('#selecaoBody input[type="checkbox"]').forEach(cb => { cb.checked = false; });
        atualizarContagemSelecao();
        return;
      }
      if (e.target.closest('#btnImprimirSelecao')) {
        const ids = idsSelecionados();
        if (!ids.length) return;
        fecharSelecaoImpressao();
        if (selecaoModo === 'mini-todos') {
          const regs = ids.map(id => store.findRegisto(id)).filter(Boolean);
          abrirImpressaoMiniRecibos(regs, 'Recibos Pendentes (' + regs.length + ')');
        } else {
          imprimirViagensSelecionadas(selecaoNome, ids);
        }
      }
    });

    ov.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]')) atualizarContagemSelecao();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') fecharSelecaoImpressao();
    });
  }

  function imprimirViagensSelecionadas(nome, ids) {
    const lista = ids
      .map(id => store.findRegisto(id))
      .filter(Boolean)
      .sort((a, b) => a.saidaData.localeCompare(b.saidaData));

    if (!lista.length) {
      alert('Não há viagens para imprimir neste intervalo.');
      return;
    }

    const dataInicio = lista[0].saidaData;
    const dataFim = lista.reduce((max, r) => {
      const d = r.regressoEfetivoData || r.regressoData;
      return d > max ? d : max;
    }, lista[0].regressoEfetivoData || lista[0].regressoData);
    const periodoLabel = fmtDate(dataInicio) + ' a ' + fmtDate(dataFim);

    let somaBase = 0, somaDelta = 0, somaTotal = 0, somaEntregue = 0;
    const temOficial = lista.some(r => r.tipo === 'oficial');

    const linhas = lista.map((r) => {
      const dataRegresso = r.regressoEfetivoData || r.regressoData;
      const horaRegresso = r.regressoEfetivoHora || r.regressoHora;
      const plan = buildTripPlan(r.saidaData, r.saidaHora, dataRegresso, horaRegresso, r.incFimSemana);
      const t = computeTotals(plan, store.state.values, r.tipo);
      const dias = plan.length;
      const diasComRefeicoes = plan.filter(d => d.meals.length).length;
      const diferenca = t.totalGeral - r.totalOriginal;

      somaBase += t.totalBase;
      somaDelta += t.totalDelta;
      somaTotal += t.totalGeral;
      somaEntregue += r.totalOriginal;

      const estado = r.concluido ? 'Concluído' : (r.faturaEntregue ? 'Despesa entregue' : 'Por entregar');

      const detalhes = [];
      if (r.obra) detalhes.push('Obra: ' + esc(r.obra));
      if (r.ajudanteAssoc) detalhes.push('Ajudante: ' + esc(r.ajudanteAssoc));
      detalhes.push('Entregue por: ' + esc(r.entreguePor && r.entreguePor !== 'Pendente' ? r.entreguePor : '—'));
      detalhes.push('Dinheiro: ' + esc(r.dataEntregaDinheiro ? fmtDate(r.dataEntregaDinheiro) : '—'));
      if (r.faturaEntregueA) detalhes.push('Despesa entregue a: ' + esc(r.faturaEntregueA));
      detalhes.push('Adiantado: ' + esc(eur.format(r.totalOriginal)));
      detalhes.push((diferenca < 0 ? 'Devolveu: ' : 'A pagar: ') + esc(eur.format(Math.abs(diferenca))));

      const colSpan = temOficial ? 6 : 5;

      return (
        '<tr class="linha">' +
          '<td>' + esc(fmtDate(r.saidaData)) + ' ' + esc(r.saidaHora || '') + '<br>' +
              '<span class="ate">até</span> ' + esc(fmtDate(dataRegresso)) + ' ' + esc(horaRegresso || '') + '</td>' +
          '<td class="c">' + dias + '<br><span class="ate">' + diasComRefeicoes + ' c/ ref.</span></td>' +
          '<td class="n">' + esc(eur.format(t.totalBase)) + '</td>' +
          (temOficial ? '<td class="n">' + esc(eur.format(t.totalDelta)) + '</td>' : '') +
          '<td class="n forte">' + esc(eur.format(t.totalGeral)) + '</td>' +
          '<td class="c">' + estado + '</td>' +
        '</tr>' +
        '<tr class="sub"><td colspan="' + colSpan + '">' + detalhes.join(' &nbsp;·&nbsp; ') +
          (r.observacoes ? '<div class="obs"><b>Obs.:</b> ' + esc(r.observacoes) + '</div>' : '') +
        '</td></tr>'
      );
    }).join('');

    const html =
      '<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8">' +
      '<title>' + esc(nome) + ' — ' + esc(periodoLabel) + '</title>' +
      '<style>' +
      '  @page { size: A4 portrait; margin: 12mm; }' +
      '  * { box-sizing: border-box; }' +
      '  body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #17211f; margin: 0; font-size: 11px; }' +
      '  h1 { font-size: 16px; margin: 0; color: #0a3634; }' +
      '  .cab { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #b5622f; padding-bottom: 3mm; margin-bottom: 4mm; }' +
      '  .cab .mes { font-size: 12px; color: #4a5854; }' +
      '  .cab .meta { font-size: 10px; color: #8a958f; text-align: right; }' +
      '  table { width: 100%; border-collapse: collapse; }' +
      '  thead th { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #4a5854; text-align: left; border-bottom: 1px solid #17211f; padding: 2mm 1.5mm; }' +
      '  tr.linha td { padding: 2mm 1.5mm 1mm; vertical-align: top; border-top: 1px solid #d8ddd6; }' +
      '  tr.sub td { padding: 0 1.5mm 2mm; font-size: 9px; color: #4a5854; }' +
      '  tr.linha { page-break-inside: avoid; }' +
      '  .n { text-align: right; font-family: "Consolas", monospace; white-space: nowrap; }' +
      '  .c { text-align: center; }' +
      '  .forte { font-weight: 700; color: #0a3634; }' +
      '  .ate { color: #8a958f; font-size: 9px; }' +
      '  .obs { margin-top: 1mm; padding-left: 2mm; border-left: 2px solid #b5622f; white-space: pre-wrap; }' +
      '  tfoot td { border-top: 2px solid #17211f; padding: 2.5mm 1.5mm; font-weight: 700; font-size: 12px; }' +
      '  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }' +
      '</style></head><body>' +
      '<div class="cab">' +
        '<div><h1>' + esc(nome) + '</h1><div class="mes">' + esc(periodoLabel) + ' &middot; ' + lista.length + ' viagem(ns)</div></div>' +
        '<div class="meta">Impresso em ' + esc(fmtDate(todayISO())) + '</div>' +
      '</div>' +
      '<table>' +
        '<thead><tr>' +
          '<th>Período</th><th class="c">Dias</th><th class="n">Base</th>' +
          (temOficial ? '<th class="n">Adicional</th>' : '') +
          '<th class="n">Total</th><th class="c">Estado</th>' +
        '</tr></thead>' +
        '<tbody>' + linhas + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="2">Total do período</td>' +
          '<td class="n">' + esc(eur.format(somaBase)) + '</td>' +
          (temOficial ? '<td class="n">' + esc(eur.format(somaDelta)) + '</td>' : '') +
          '<td class="n">' + esc(eur.format(somaTotal)) + '</td>' +
          '<td class="c" style="font-weight:400;font-size:9px;">Adiantado: ' + esc(eur.format(somaEntregue)) + '</td>' +
        '</tr></tfoot>' +
      '</table>' +
      '<script>window.onload = function() { setTimeout(function() { window.print(); }, 150); };<\/script>' +
      '</body></html>';

    const w = window.open('', '_blank');
    if (!w) {
      alert('Ativa os pop-ups para poder imprimir.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /* ============================================================
   *  REGISTOS E AGRUPAMENTO MENSAL
   * ============================================================ */
  function overlapsFilter(r, fStart, fEnd) {
    if (!fStart && !fEnd) return true;
    const rStart = r.saidaData;
    const rEnd = r.regressoEfetivoData || r.regressoData;
    if (fStart && rEnd < fStart) return false;
    if (fEnd && rStart > fEnd) return false;
    return true;
  }

  function renderRegistos() {
    ui.viagensAbertas = new Set(
      Array.from(document.querySelectorAll('details.viagem[open]')).map(el => el.dataset.rid)
    );

    const abertos = new Set(
      Array.from(document.querySelectorAll('details.user-group[open]'))
        .map(el => el.dataset.user)
    );

    if(ui.fecharGrupoNome) {
      abertos.delete(ui.fecharGrupoNome.toUpperCase());
      ui.fecharGrupoNome = null;
    }

    const filtrados = store.state.registos.filter(r =>
      r.status !== 'pendente' &&
      overlapsFilter(r, ui.filtroInicio, ui.filtroFim) &&
      (ui.filtroTipo === 'todos' || r.tipo === ui.filtroTipo)
    );

    const ativos = filtrados.filter((r) => !r.concluido);
    const naoAtivos = filtrados.filter((r) => r.concluido);

    const sectHd = (variant, titulo, count) =>
      '<div class="sect ' + variant + '">' +
        '<span class="title">' + titulo + '</span>' +
        '<span class="count">· ' + count + '</span>' +
        '<span class="rule"></span>' +
      '</div>';

    const ativosHtml = ativos.length
      ? renderGroupedList(ativos, abertos)
      : '<div class="empty">Ainda não há registos ativos.</div>';
    $('#registosAtivos').innerHTML = sectHd('owed', 'Despesas por Entregar', ativos.length) + ativosHtml;

    if (naoAtivos.length) {
      $('#registosNaoAtivos').innerHTML =
        sectHd('done', 'Despesas Entregues', naoAtivos.length) +
        renderGroupedList(naoAtivos, abertos);
    } else {
      $('#registosNaoAtivos').innerHTML = '';
    }

    wireRegistos();
  }

  function renderGroupedList(list, abertos = new Set()) {
    for (const r of list) {
      const dataRegresso = r.regressoEfetivoData || r.regressoData;
      const horaRegresso = r.regressoEfetivoHora || r.regressoHora;
      const plan = buildTripPlan(r.saidaData, r.saidaHora, dataRegresso, horaRegresso, r.incFimSemana);
      r.totalGeral = computeTotals(plan, store.state.values, r.tipo).totalGeral;
    }

    const userGroups = {};
    for (const r of list) {
      const uKey = r.nome.toUpperCase();
      if (!userGroups[uKey]) userGroups[uKey] = { nome: r.nome, registos: [] };
      userGroups[uKey].registos.push(r);
    }

    return Object.values(userGroups)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
      .map((g) => {
        const sumTotal = g.registos.reduce((acc, curr) => acc + curr.totalGeral, 0);
        const isOpen = abertos.has(g.nome.toUpperCase()) ? ' open' : '';

        const primeiroRegisto = g.registos[0];
        const tagClass = primeiroRegisto.tipo === 'oficial' ? 'ofic' : 'ajud';
        const tagText = primeiroRegisto.tipo === 'oficial' ? 'Oficial' : 'Ajudante';

        const monthGroups = {};
        for (const r of g.registos) {
          const mKey = getMonthKey(r.saidaData);
          if (!monthGroups[mKey]) monthGroups[mKey] = [];
          monthGroups[mKey].push(r);
        }

        const monthsHtml = Object.keys(monthGroups)
          .sort((a, b) => b.localeCompare(a))
          .map((mKey) => {
            const mList = monthGroups[mKey];
            let mBase = 0, mDelta = 0;
            for (const r of mList) {
              const plan = buildTripPlan(r.saidaData, r.saidaHora, r.regressoEfetivoData || r.regressoData, r.regressoEfetivoHora || r.regressoHora, r.incFimSemana);
              const t = computeTotals(plan, store.state.values, r.tipo);
              mBase += t.totalBase;
              mDelta += t.totalDelta;
            }
            const mTotal = mBase + mDelta;
            const totalComArredondamento = getArredondamento(mTotal).arredondado;
            const cards = mList.map(recCard).join('');
            const deltaBadge = mDelta > 0 ? ' | <span style="color: var(--copper); font-weight: 700;">Extra Oficial: +' + eur.format(mDelta) + '</span>' : '';

            return (
              '<details class="month-group" open>' +
                '<summary class="month-summary">' +
                  '<span>' + esc(getMonthLabel(mKey)) + '</span>' +
                  '<span class="month-right">' +
                    '<span class="money">Base: ' + eur.format(mBase) + deltaBadge + ' | Total: ' + eur.format(totalComArredondamento) + '</span>' +
                    '<button class="btn ghost small btn-print-mes" data-role="imprimir-mes"' +
                      ' data-nome="' + esc(g.nome) + '"' +
                      ' data-rids="' + mList.map(x => x.id).join(',') + '"' +
                      ' title="Escolher viagens para imprimir">🖨️</button>' +
                  '</span>' +
                '</summary>' +
                '<div class="month-content">' + cards + '</div>' +
              '</details>'
            );
          }).join('');

        return (
          '<details class="user-group" data-user="' + esc(g.nome.toUpperCase()) + '"' + isOpen + '>' +
            '<summary class="user-summary">' +
              '<div class="user-title">' +
                '<span>' + esc(g.nome) + '</span>' +
                '<span class="tag ' + tagClass + '">' + tagText + '</span>' +
              '</div>' +
              '<div class="user-stats">' +
                '<span class="user-total money">' + eur.format(sumTotal) + '</span>' +
                '<span class="chevron">▼</span>' +
              '</div>' +
            '</summary>' +
            '<div class="user-content">' + monthsHtml + '</div>' +
          '</details>'
        );
      }).join('');
  }

  function recCard(r) {
    const dataRegressoAtual = r.regressoEfetivoData || r.regressoData;
    const horaRegressoAtual = r.regressoEfetivoHora || r.regressoHora;

    const planEfetivo = buildTripPlan(r.saidaData, r.saidaHora, dataRegressoAtual, horaRegressoAtual, r.incFimSemana);
    const totalsEfetivos = computeTotals(planEfetivo, store.state.values, r.tipo);

    r.totalGeral = totalsEfetivos.totalGeral;
    let diferenca = r.totalGeral - r.totalOriginal;

    const saidaInicial = r.saidaDataInicial || r.saidaData;
    const horaSaidaInicial = r.saidaHoraInicial || r.saidaHora;
    const regressoInicial = r.regressoDataInicial || r.regressoData;
    const horaRegressoInicial = r.regressoHoraInicial || r.regressoHora;

    const houveAlteracaoDatas = (
      r.saidaData !== saidaInicial ||
      r.saidaHora !== horaSaidaInicial ||
      dataRegressoAtual !== regressoInicial ||
      horaRegressoAtual !== horaRegressoInicial
    );

    if (diferenca < 0 && !houveAlteracaoDatas) {
      diferenca = 0;
    }

    r.valorAjuste = diferenca;

    const arrEfetivo = totalsEfetivos.arredondamento || getArredondamento(totalsEfetivos.totalBruto);
    const diffSign = arrEfetivo.diff > 0 ? '+' : '';

    if (r.concluido) {
      const valorTotalConcluido = (r.tipo === 'oficial')
        ? eur.format(totalsEfetivos.totalBase) + ' + ' + eur.format(totalsEfetivos.totalDelta) + ' = ' + eur.format(r.totalGeral)
        : eur.format(r.totalGeral);

      return (
        '<div class="rec concluido" data-rid="' + r.id + '" data-role="ver-detalhes" title="Ver detalhes da viagem" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--sp-2);">' +
          '<div>' +
            '<div style="font-size: 14px; font-weight: 600; color: var(--ink);">' +
              esc(fmtDate(r.saidaData)) + ' — ' + esc(fmtDate(dataRegressoAtual)) +
            '</div>' +
            '<div class="ver-detalhe-hint">Ver detalhes</div>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: var(--sp-4);">' +
            '<span class="money" style="font-size: 15px; font-weight: 700; color: var(--petrol-deep);">' + valorTotalConcluido + '</span>' +
            '<button class="btn danger small" data-role="apagar-registo">Apagar</button>' +
          '</div>' +
        '</div>'
      );
    }

    let labelAjuste = "Valor Adicional a Pagar:";
    let valorAjusteClass = "";

    if (diferenca < 0) {
      labelAjuste = "Valor a Receber de Volta (Devolução):";
      valorAjusteClass = "devolver";
    }

    const valorFinalDisplay = (r.tipo === 'oficial')
      ? eur.format(totalsEfetivos.totalBase) + ' + ' + eur.format(totalsEfetivos.totalDelta) + ' = ' + eur.format(r.totalGeral)
      : eur.format(r.totalGeral);

    const adjustHtml =
      '<div class="adjust-metrics">' +
        (r.tipo === 'oficial' ?
          '<div class="adjust-row"><span>Valor Base (Ajudante):</span><span class="money">' + eur.format(totalsEfetivos.totalBase) + '</span></div>' +
          '<div class="adjust-row" style="color: var(--copper); font-weight: 600;"><span>Adicional Oficial:</span><span class="money">' + eur.format(totalsEfetivos.totalDelta) + '</span></div>'
          : ''
        ) +
        '<div class="adjust-row"><span>Valor do Arredondamento (' + arrEfetivo.original + '€ -> ' + arrEfetivo.arredondado + '€):</span><span class="money">' + diffSign + arrEfetivo.diff + '€</span></div>' +
        '<div class="adjust-row"><span>Valor Entregue (Adiantado):</span><span class="money">' + eur.format(r.totalOriginal) + '</span></div>' +
        '<div class="adjust-row"><span>' + labelAjuste + '</span><span class="money ' + valorAjusteClass + '">' + eur.format(Math.abs(diferenca)) + '</span></div>' +
        '<div class="adjust-row highlight"><span>Valor Final Ajustado:</span><span class="money">' + valorFinalDisplay + '</span></div>' +
      '</div>';

    const btnDinheiroEntregue = (r.status === 'pendente')
      ? '<button class="btn success small" data-role="dinheiro-entregue">Dinheiro Entregue</button>'
      : '';

    const btnTerminar = (r.faturaEntregue && !r.concluido && r.status !== 'pendente')
      ? '<button class="btn success small" data-role="terminar-processo">Terminar Processo</button>'
      : '';

    let inputColaborador = '';
    if (r.tipo === 'oficial') {
      const oficiaisOrdenados = store.state.oficiais.slice().sort((a, b) => a.localeCompare(b, 'pt'));
      const options = oficiaisOrdenados.map(n =>
        '<option value="' + esc(n) + '"' + (n.toUpperCase() === r.nome.toUpperCase() ? ' selected' : '') + '>' + esc(n) + '</option>'
      ).join('');
      inputColaborador = '<select data-role="inputNovoColaborador">' + options + '</select>';
    } else {
      inputColaborador = '<input type="text" data-role="inputNovoColaborador" value="' + esc(r.nome) + '" placeholder="Escreva o novo nome">';
    }

    const pendenteHeaderHtml = (r.status === 'pendente') ? (
      '<div style="padding: 10px 16px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-weight: 700; font-size: 15px; display: flex; justify-content: space-between; align-items: center;">' +
        '<span>' + esc(r.nome) + ' <span class="tag ' + (r.tipo === 'oficial' ? 'ofic' : 'ajud') + '">' + (r.tipo === 'oficial' ? 'Oficial' : 'Ajudante') + '</span></span>' +
        '<span class="money" style="color: var(--copper); font-size: 12px; font-weight: 700; letter-spacing: 0.05em;">PENDENTE</span>' +
      '</div>'
    ) : '';

    const entreguePorOptions = ['Carla', 'Esmeralda', 'Inês', 'Rodrigo'];
    const currentEntregue = (r.entreguePor && r.entreguePor !== 'Pendente') ? r.entreguePor : 'Inês';

    const entreguePorHtml = (r.status === 'pendente') ? (
      '<select data-role="entreguePorSelectPendente">' +
        entreguePorOptions.map(opt =>
          '<option value="' + opt + '"' + (opt === currentEntregue ? ' selected' : '') + '>' + opt + '</option>'
        ).join('') +
      '</select>'
    ) : (
      '<span class="readonly-info">' + esc(r.entreguePor || '—') + '</span>'
    );

    const dataEntregaDinheiroHtml = (r.status === 'pendente') ? (
      '<input type="date" data-role="dataEntregaDinheiroPendente" value="' + esc(r.dataEntregaDinheiro || '') + '">'
    ) : (
      '<span class="readonly-info">' + esc(r.dataEntregaDinheiro ? fmtDate(r.dataEntregaDinheiro) : '—') + '</span>'
    );

    const recebidoPorHtml = (r.status === 'pendente') ? (
      '<input type="text" data-role="recebidoPorPendente" value="' + esc(r.recebidoPor || r.nome) + '">'
    ) : (
      '<span class="readonly-info">' + esc(r.recebidoPor || r.nome || '—') + '</span>'
    );

    const observacoesHtml = (r.status === 'pendente') ? (
      '<textarea data-role="observacoesPendente" rows="2" placeholder="Notas sobre esta viagem">' + esc(r.observacoes || '') + '</textarea>'
    ) : (
      (r.observacoes ? '<span class="readonly-info" style="white-space:pre-wrap;">' + esc(r.observacoes) + '</span>' : '')
    );

    const despesaEntregueCheckboxHtml = (r.status === 'pendente') ? '' : (
      '<label class="checkbox-field" style="margin:0;">' +
        '<input type="checkbox" class="check" data-role="faturaEntregue"' + (r.faturaEntregue ? ' checked' : '') + '>' +
        '<span>Despesa Entregue</span>' +
      '</label>'
    );

    const recHtml = (
      '<div class="rec" data-rid="' + r.id + '">' +
        pendenteHeaderHtml +
        (subMeta(r.obra, r.ajudanteAssoc) ? '<div class="rec-sub">' + subMeta(r.obra, r.ajudanteAssoc) + '</div>' : '') +

        '<div class="rec-body">' +
          '<div class="edit-colaborador-box" data-role="boxEditColaborador">' +
            '<label>Alterar ' + (r.tipo === 'oficial' ? 'Oficial' : 'Ajudante') + '</label>' +
            '<div style="display:flex; gap:var(--sp-2); margin-top:4px;">' +
              inputColaborador +
              '<button class="btn accent small" data-role="confirmar-troca-colaborador">Confirmar</button>' +
              '<button class="btn ghost small" data-role="cancelar-troca-colaborador">Cancelar</button>' +
            '</div>' +
          '</div>' +

          '<div class="adjust-box" style="margin-top:0;">' +
            '<h4>Período de Viagem &amp; Ajuste</h4>' +
            '<label class="checkbox-field" style="margin-bottom:var(--sp-3);">' +
              '<input type="checkbox" class="check" data-role="incFimSemana"' + (r.incFimSemana ? ' checked' : '') + '>' +
              '<span>Incluir fins de semana no ajuste</span>' +
            '</label>' +
            '<div class="grid-2">' +
              '<div>' +
                '<label>Data e Hora de Partida</label>' +
                '<div class="datetime">' +
                  '<input type="date" data-role="saidaData" value="' + esc(r.saidaData) + '">' +
                  '<input type="time" data-role="saidaHora" value="' + esc(r.saidaHora) + '">' +
                '</div>' +
              '</div>' +
              '<div>' +
                '<label>Data e Hora de Regresso Efetiva</label>' +
                '<div class="datetime">' +
                  '<input type="date" data-role="regressoEfetivoData" value="' + esc(r.regressoEfetivoData || r.regressoData) + '">' +
                  '<input type="time" data-role="regressoEfetivoHora" value="' + esc(r.regressoEfetivoHora || r.regressoHora) + '">' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top: var(--sp-3); display: flex; justify-content: flex-end;">' +
              '<button type="button" class="btn accent small" data-role="guardar-alteracoes-data">Guardar Alterações</button>' +
            '</div>' +
            adjustHtml +
          '</div>' +

          '<div class="despesa-entregue-box">' +
            '<div class="grid-3">' +
              '<div>' +
                '<label>Entregue Por</label>' +
                entreguePorHtml +
              '</div>' +
              '<div>' +
                '<label>Recebido Por</label>' +
                recebidoPorHtml +
              '</div>' +
              '<div>' +
                '<label>Data Entrega Dinheiro</label>' +
                dataEntregaDinheiroHtml +
              '</div>' +
            '</div>' +

            ((r.status === 'pendente' || r.observacoes) ? (
              '<div style="margin-top: var(--sp-3);">' +
                '<label>Observações</label>' +
                observacoesHtml +
              '</div>'
            ) : '') +

            (despesaEntregueCheckboxHtml ? (
              '<div style="margin-top: var(--sp-3);">' + despesaEntregueCheckboxHtml + '</div>'
            ) : '') +

            (r.status !== 'pendente' ? (
              '<div class="fatura-box' + (r.faturaEntregue ? ' visible' : '') + '">' +
                '<div class="grid-2">' +
                  '<div>' +
                    '<label>Despesa Entregue A</label>' +
                    '<input type="text" data-role="faturaEntregueA" value="' + esc(r.faturaEntregueA) + '" placeholder="A quem foi entregue">' +
                  '</div>' +
                  '<div>' +
                    '<label>Data de Entrega da Despesa</label>' +
                    '<input type="date" data-role="dataEntregaFatura" value="' + esc(r.dataEntregaFatura) + '">' +
                  '</div>' +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>' +

        '<div class="rec-foot">' +
          '<div style="display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap;">' +
            '<button class="btn ghost small" data-role="abrir-editar-colaborador">Editar colaborador</button>' +
            btnDinheiroEntregue +
            btnTerminar +
          '</div>' +
          '<button class="btn danger small" data-role="apagar-registo">Apagar registo</button>' +
        '</div>' +
      '</div>'
    );

    if (r.status === 'pendente') return recHtml;

    const isOpen = ui.viagensAbertas.has(r.id) ? ' open' : '';
    const avisoAjuste = (Math.abs(diferenca) >= 0.005)
      ? '<span class="viagem-flag' + (diferenca < 0 ? ' devolver' : '') + '">' +
          (diferenca < 0 ? 'Devolver ' : 'A pagar ') + eur.format(Math.abs(diferenca)) +
        '</span>'
      : '';

    const obsPreview = (r.observacoes && r.observacoes.trim())
      ? '<div class="viagem-obs" title="' + esc(r.observacoes) + '">📝 ' + esc(r.observacoes) + '</div>'
      : '';

    return (
      '<details class="viagem" data-rid="' + r.id + '"' + isOpen + '>' +
        '<summary class="viagem-summary">' +
          '<span class="viagem-datas">' + esc(fmtDate(r.saidaData)) + ' — ' + esc(fmtDate(dataRegressoAtual)) + obsPreview + '</span>' +
          '<span class="viagem-vals">' +
            avisoAjuste +
            '<span class="money viagem-total">' + valorFinalDisplay + '</span>' +
            '<span class="viagem-chevron">▼</span>' +
          '</span>' +
        '</summary>' +
        recHtml +
      '</details>'
    );
  }

  /* ============================================================
   *  DETALHE DE VIAGEM CONCLUÍDA (APENAS LEITURA)
   * ============================================================ */
  function detRow(k, v, cls) {
    return '<div class="det-row' + (cls ? ' ' + cls : '') + '">' +
             '<span class="k">' + k + '</span>' +
             '<span class="v">' + v + '</span>' +
           '</div>';
  }

  function detalheViagemHtml(r) {
    const dataRegresso = r.regressoEfetivoData || r.regressoData;
    const horaRegresso = r.regressoEfetivoHora || r.regressoHora;

    const plan = buildTripPlan(r.saidaData, r.saidaHora, dataRegresso, horaRegresso, r.incFimSemana);
    const totals = computeTotals(plan, store.state.values, r.tipo);
    const arr = totals.arredondamento || getArredondamento(totals.totalBruto);
    const diffSign = arr.diff > 0 ? '+' : '';
    const diferenca = totals.totalGeral - r.totalOriginal;

    const saidaInicial = r.saidaDataInicial || r.saidaData;
    const horaSaidaInicial = r.saidaHoraInicial || r.saidaHora;
    const regressoInicial = r.regressoDataInicial || r.regressoData;
    const horaRegressoInicial = r.regressoHoraInicial || r.regressoHora;
    const houveAlteracaoDatas = (
      r.saidaData !== saidaInicial || r.saidaHora !== horaSaidaInicial ||
      dataRegresso !== regressoInicial || horaRegresso !== horaRegressoInicial
    );

    /* --- Período --- */
    const periodoHtml =
      '<div class="det-block">' +
        '<h4>Período da viagem</h4>' +
        detRow('Partida', esc(fmtDate(r.saidaData)) + ' &middot; ' + esc(r.saidaHora || '—')) +
        detRow('Regresso efetivo', esc(fmtDate(dataRegresso)) + ' &middot; ' + esc(horaRegresso || '—')) +
        (houveAlteracaoDatas
          ? detRow('Previsto inicialmente',
              esc(fmtDate(saidaInicial)) + ' ' + esc(horaSaidaInicial || '') + ' → ' +
              esc(fmtDate(regressoInicial)) + ' ' + esc(horaRegressoInicial || ''))
          : '') +
        detRow('Fins de semana incluídos', r.incFimSemana ? 'Sim' : 'Não') +
      '</div>';

    /* --- Refeições por dia --- */
    const dayRows = plan.map((day) => {
      const chips = MEALS.map((m) => (
        '<span class="chip' + (day.meals.includes(m.key) ? ' on' : '') + '">' + m.label + '</span>'
      )).join('');
      const none = day.meals.length === 0
        ? '<span class="chip none">' + (day.isWeekend ? 'fim de semana' : 'sem refeições') + '</span>'
        : '';
      return (
        '<div class="day-row' + (day.isWeekend ? ' weekend' : '') + '">' +
          '<div class="day-label">' +
            '<span class="day-date">' + esc(fmtDate(day.date)) + '</span>' +
            '<span class="day-kind">' + KIND_LABEL[day.kind] + '</span>' +
          '</div>' +
          '<div class="meals">' + chips + none + '</div>' +
        '</div>'
      );
    }).join('');

    const refeicoesHtml =
      '<div class="det-block">' +
        '<h4>Refeições por dia</h4>' +
        (dayRows ? '<div class="breakdown">' + dayRows + '</div>' : '<div class="empty">Sem dias a apresentar.</div>') +
      '</div>';

    /* --- Valores --- */
    const labelDiferenca = diferenca < 0 ? 'Valor devolvido' : 'Valor adicional pago';
    const valoresHtml =
      '<div class="det-block">' +
        '<h4>Valores</h4>' +
        detRow('Valor base (Ajudante)', '<span class="money">' + eur.format(totals.totalBase) + '</span>') +
        (r.tipo === 'oficial'
          ? detRow('Adicional Oficial', '<span class="money" style="color:var(--copper)">' + eur.format(totals.totalDelta) + '</span>')
          : '') +
        detRow('Arredondamento (' + arr.original + '€ → ' + arr.arredondado + '€)', '<span class="money">' + diffSign + arr.diff + '€</span>') +
        detRow('Valor entregue (adiantado)', '<span class="money">' + eur.format(r.totalOriginal) + '</span>') +
        detRow(labelDiferenca, '<span class="money' + (diferenca < 0 ? ' devolver' : '') + '">' + eur.format(Math.abs(diferenca)) + '</span>') +
        detRow('Valor final', '<span class="money">' + eur.format(totals.totalGeral) + '</span>', 'total') +
      '</div>';

    /* --- Entrega / conclusão --- */
    const entregaHtml =
      '<div class="det-block">' +
        '<h4>Entrega &amp; conclusão</h4>' +
        detRow('Entregue por', esc(r.entreguePor && r.entreguePor !== 'Pendente' ? r.entreguePor : '—')) +
        detRow('Recebido por', esc(r.recebidoPor || r.nome || '—')) +
        detRow('Data entrega dinheiro', esc(r.dataEntregaDinheiro ? fmtDate(r.dataEntregaDinheiro) : '—')) +
        detRow('Despesa entregue a', esc(r.faturaEntregueA || '—')) +
        detRow('Data entrega da despesa', esc(r.dataEntregaFatura ? fmtDate(r.dataEntregaFatura) : '—')) +
        detRow('Data de conclusão', esc(r.dataConclusao ? fmtDate(r.dataConclusao) : '—')) +
      '</div>';

    const obsHtml = r.observacoes
      ? '<div class="det-block"><h4>Observações</h4><div class="det-obs">' + esc(r.observacoes) + '</div></div>'
      : '';

    return periodoHtml + refeicoesHtml + valoresHtml + entregaHtml + obsHtml;
  }

  function abrirDetalheViagem(id) {
    const r = store.findRegisto(id);
    if (!r) return;

    const tagClass = r.tipo === 'oficial' ? 'ofic' : 'ajud';
    const tagText = r.tipo === 'oficial' ? 'Oficial' : 'Ajudante';

    $('#detalheTitulo').innerHTML =
      esc(r.nome) + ' <span class="tag ' + tagClass + '">' + tagText + '</span>';

    const subBits = [];
    if (r.obra) subBits.push('Obra: ' + esc(r.obra));
    if (r.ajudanteAssoc) subBits.push('Ajudante: ' + esc(r.ajudanteAssoc));
    subBits.push(esc(fmtDate(r.saidaData)) + ' — ' + esc(fmtDate(r.regressoEfetivoData || r.regressoData)));
    $('#detalheSub').innerHTML = subBits.join(' &middot; ');

    $('#detalheBody').innerHTML = detalheViagemHtml(r);
    $('#detalheBody').scrollTop = 0;
    $('#detalheOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function fecharDetalheViagem() {
    const ov = $('#detalheOverlay');
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    $('#detalheBody').innerHTML = '';
    document.body.style.overflow = '';
  }

  function wireDetalheViagem() {
    const ov = $('#detalheOverlay');
    if (!ov || ov.dataset.wired) return;
    ov.dataset.wired = '1';

    ov.addEventListener('click', (e) => {
      if (e.target === ov ||
          e.target.closest('#btnFecharDetalhe') ||
          e.target.closest('[data-role="fechar-detalhe"]')) {
        fecharDetalheViagem();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') fecharDetalheViagem();
    });
  }

  function wireRegistos() {
    wireDetalheViagem();
    wireSelecaoImpressao();
    const mainContainer = $('main');
    if (mainContainer.dataset.wired) return;
    mainContainer.dataset.wired = '1';

    $('#filtroTipoToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filtro-tipo]');
      if (!btn) return;
      ui.filtroTipo = btn.dataset.filtroTipo;
      $$('#filtroTipoToggle button').forEach((b) => b.classList.toggle('active', b === btn));
      renderRegistos();
    });

    $('#btnAplicarFiltro').addEventListener('click', () => {
      ui.filtroInicio = $('#filtroDataInicio').value;
      ui.filtroFim = $('#filtroDataFim').value;
      renderRegistos();
    });
    $('#btnLimparFiltro').addEventListener('click', () => {
      $('#filtroDataInicio').value = '';
      $('#filtroDataFim').value = '';
      ui.filtroInicio = '';
      ui.filtroFim = '';
      ui.filtroTipo = 'todos';
      $$('#filtroTipoToggle button').forEach((b) => b.classList.toggle('active', b.dataset.filtroTipo === 'todos'));
      renderRegistos();
    });

    mainContainer.addEventListener('change', (e) => {
      if (e.target.dataset.role === 'inputNovoColaborador') return;

      const rec = e.target.closest('.rec[data-rid]');
      if (!rec) return;
      const registo = store.findRegisto(rec.dataset.rid);
      if (!registo) return;

      const role = e.target.dataset.role;

      if (role === 'saidaData' || role === 'saidaHora' || role === 'regressoEfetivoData' || role === 'regressoEfetivoHora' || role === 'incFimSemana') {
        return;
      }

      if (role === 'entreguePorSelectPendente') registo.entreguePor = e.target.value;
      else if (role === 'dataEntregaDinheiroPendente') registo.dataEntregaDinheiro = e.target.value;
      else if (role === 'recebidoPorPendente') registo.recebidoPor = e.target.value;
      else if (role === 'observacoesPendente') registo.observacoes = e.target.value;
      else if (role === 'faturaEntregue') registo.faturaEntregue = e.target.checked;
      else if (role === 'faturaEntregueA') registo.faturaEntregueA = e.target.value;
      else if (role === 'dataEntregaFatura') registo.dataEntregaFatura = e.target.value;

      store.save();
      if (registo.status === 'pendente') renderPendentes();
      else renderRegistos();
    });

    mainContainer.addEventListener('click', (e) => {
      if (e.target.closest('#btnImprimirTodosPendentes')) {
        imprimirTodosPendentes();
        return;
      }

      const imprimirMes = e.target.closest('button[data-role="imprimir-mes"]');
      if (imprimirMes) {
        e.preventDefault();
        e.stopPropagation();
        const ids = (imprimirMes.dataset.rids || '').split(',').filter(Boolean);
        abrirSelecaoImpressao(imprimirMes.dataset.nome, ids);
        return;
      }

      const rec = e.target.closest('.rec[data-rid]');

      const apagar = e.target.closest('button[data-role="apagar-registo"]');
      if (apagar) {
        if (!rec) return;
        if (confirm('Apagar este registo? Esta ação não pode ser anulada.')) {
          store.removeRegisto(rec.dataset.rid);
          renderPendentes();
          renderRegistos();
        }
        return;
      }

      const verDetalhes = e.target.closest('[data-role="ver-detalhes"]');
      if (verDetalhes && !e.target.closest('button')) {
        abrirDetalheViagem(verDetalhes.dataset.rid);
        return;
      }

      const guardarDatas = e.target.closest('button[data-role="guardar-alteracoes-data"]');
      if (guardarDatas) {
        if (!rec) return;
        const registo = store.findRegisto(rec.dataset.rid);
        if (registo) {
          const sData = rec.querySelector('[data-role="saidaData"]');
          const sHora = rec.querySelector('[data-role="saidaHora"]');
          const rData = rec.querySelector('[data-role="regressoEfetivoData"]');
          const rHora = rec.querySelector('[data-role="regressoEfetivoHora"]');
          const incFim = rec.querySelector('[data-role="incFimSemana"]');

          if (sData) registo.saidaData = sData.value;
          if (sHora) registo.saidaHora = sHora.value;
          if (rData) registo.regressoEfetivoData = rData.value;
          if (rHora) registo.regressoEfetivoHora = rHora.value;
          if (incFim) registo.incFimSemana = incFim.checked;

          const dReg = registo.regressoEfetivoData || registo.regressoData;
          const hReg = registo.regressoEfetivoHora || registo.regressoHora;
          const planEfetivo = buildTripPlan(registo.saidaData, registo.saidaHora, dReg, hReg, registo.incFimSemana);
          const totalsEfetivos = computeTotals(planEfetivo, store.state.values, registo.tipo);
          registo.totalGeral = totalsEfetivos.totalGeral;

          store.save();
          if (registo.status === 'pendente') renderPendentes();
          else renderRegistos();
        }
        return;
      }

      const abrirEdit = e.target.closest('button[data-role="abrir-editar-colaborador"]');
      if (abrirEdit) {
        if (!rec) return;
        const box = rec.querySelector('[data-role="boxEditColaborador"]');
        if (box) box.classList.toggle('visible');
        return;
      }

      const cancelarEdit = e.target.closest('button[data-role="cancelar-troca-colaborador"]');
      if (cancelarEdit) {
        if (!rec) return;
        const box = rec.querySelector('[data-role="boxEditColaborador"]');
        if (box) box.classList.remove('visible');
        return;
      }

      const confirmarEdit = e.target.closest('button[data-role="confirmar-troca-colaborador"]');
      if (confirmarEdit) {
        if (!rec) return;
        const registo = store.findRegisto(rec.dataset.rid);
        const input = rec.querySelector('[data-role="inputNovoColaborador"]');
        if (registo && input) {
          const novoNome = input.value.trim().toUpperCase();
          if (!novoNome) {
            alert('Por favor, defina um nome válido.');
            return;
          }
          registo.nome = novoNome;
          store.save();
          renderPendentes();
          renderRegistos();
        }
        return;
      }

      const dinheiroEntregue = e.target.closest('button[data-role="dinheiro-entregue"]');
      if (dinheiroEntregue) {
        if (!rec) return;
        const registo = store.findRegisto(rec.dataset.rid);
        if (registo) {
          const inputData = rec.querySelector('[data-role="dataEntregaDinheiroPendente"]');
          const dataVal = inputData ? inputData.value : registo.dataEntregaDinheiro;

          if (!dataVal) {
            alert('Por favor, preencha a data de entrega do dinheiro.');
            if (inputData) inputData.focus();
            return;
          }

          if (dataVal > todayISO()) {
            alert('A data de entrega do dinheiro não pode ser no futuro.');
            if (inputData) inputData.focus();
            return;
          }

          const selectPendente = rec.querySelector('[data-role="entreguePorSelectPendente"]');
          if (selectPendente) {
            registo.entreguePor = selectPendente.value;
          } else if (!registo.entreguePor || registo.entreguePor === 'Pendente') {
            registo.entreguePor = 'Inês';
          }
          registo.dataEntregaDinheiro = dataVal;
          registo.status = 'ativo';
          store.save();
          renderPendentes();
          renderRegistos();
          // Ficamos no tab Pendentes para agilizar a entrega em lote.
          toast('Registado com sucesso');
        }
        return;
      }

      const terminar = e.target.closest('button[data-role="terminar-processo"]');
      if (terminar) {
        if (!rec) return;
        const registo = store.findRegisto(rec.dataset.rid);
        if (registo) {
          const inputEntregueA = rec.querySelector('[data-role="faturaEntregueA"]');
          if (inputEntregueA) {
            registo.faturaEntregueA = inputEntregueA.value;
          }
          const checkFatura = rec.querySelector('[data-role="faturaEntregue"]');
          if (checkFatura) {
            registo.faturaEntregue = checkFatura.checked;
          }

          if (registo.faturaEntregue && (!registo.faturaEntregueA || !registo.faturaEntregueA.trim())) {
            alert('Por favor, indique a quem foi entregue a despesa no campo "Despesa Entregue A" antes de terminar o processo.');
            if (inputEntregueA) inputEntregueA.focus();
            return;
          }

          registo.concluido = true;
          registo.status = 'concluido';
          registo.dataConclusao = todayISO();
          store.save();
          ui.fecharGrupoNome = registo.nome;
          renderRegistos();
        }
        return;
      }

    });
  }

  function wireDefinicoes() {
    $('#btnGuardarValores').addEventListener('click', onGuardarValores);
    $('#btnReporValores').addEventListener('click', () => {
      store.state.values = clone(DEFAULT_VALUES);
      store.save();
      renderDefinicoes();
      flash('#valoresMsg', 'ok', 'Valores repostos para os predefinidos.');
    });
    $('#btnAddOficial').addEventListener('click', onAddOficial);
    $('#novoOficial').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddOficial(); });
    $('#oficiaisList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-role="remover"]');
      if (!btn) return;
      const nome = btn.dataset.nome;
      store.state.oficiais = store.state.oficiais.filter((n) => n !== nome);
      store.state.oficiaisAjudantes = (store.state.oficiaisAjudantes || []).filter((n) => normalizeName(n) !== normalizeName(nome));
      store.save();
      renderOficiaisSelect();
      renderOficiaisList();
    });

    $('#oficiaisList').addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-role="toggle-ajudante"]');
      if (!cb) return;
      const nome = cb.dataset.nome;
      const list = store.state.oficiaisAjudantes || (store.state.oficiaisAjudantes = []);
      const key = normalizeName(nome);
      const idx = list.findIndex((n) => normalizeName(n) === key);
      if (cb.checked && idx === -1) list.push(nome);
      if (!cb.checked && idx !== -1) list.splice(idx, 1);
      store.save();
    });

    $('#fundirOrigem').addEventListener('change', updateFundirPreview);
    $('#fundirDestino').addEventListener('change', updateFundirPreview);
    $('#btnFundirNomes').addEventListener('click', onFundirNomes);

    $('#btnApagarTudo').addEventListener('click', () => {
      if (confirm('Apagar TODOS os dados (registos, valores e lista de oficiais) da Base de Dados? Esta ação não pode ser anulada.')) {
        store.state = {
          values: clone(DEFAULT_VALUES),
          oficiais: DEFAULT_OFICIAIS.slice(),
          oficiaisAjudantes: [],
          registos: []
        };
        store.save();
        renderOficiaisSelect();
        renderDefinicoes();
        renderPendentes();
        renderRegistos();
        flash('#valoresMsg', 'ok', 'Todos os dados foram apagados com sucesso da base de dados.');
      }
    });
  }

  function renderDefinicoes() {
    const v = store.state.values;
    $('#valTableBody').innerHTML = MEALS.map((m) => (
      '<tr>' +
        '<td>' + m.label + '</td>' +
        '<td><input type="number" min="0" step="0.01" data-tipo="ajudante" data-meal="' + m.key + '" value="' + v.ajudante[m.key] + '"></td>' +
        '<td><input type="number" min="0" step="0.01" data-tipo="oficial" data-meal="' + m.key + '" value="' + v.oficial[m.key] + '"></td>' +
      '</tr>'
    )).join('');
    renderOficiaisList();
    renderFundirNomes();
  }

  function renderFundirNomes() {
    const origemSel = $('#fundirOrigem');
    const destinoSel = $('#fundirDestino');
    if (!origemSel || !destinoSel) return;
    const nomes = getHistoricalNames().sort((a, b) => a.localeCompare(b, 'pt'));
    const opts = '<option value="">— escolher —</option>' +
      nomes.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    const prevOrigem = origemSel.value;
    const prevDestino = destinoSel.value;
    origemSel.innerHTML = opts;
    destinoSel.innerHTML = opts;
    if (nomes.some(n => n === prevOrigem)) origemSel.value = prevOrigem;
    if (nomes.some(n => n === prevDestino)) destinoSel.value = prevDestino;
    updateFundirPreview();
  }

  function updateFundirPreview() {
    const origem = $('#fundirOrigem').value;
    const destino = $('#fundirDestino').value;
    const preview = $('#fundirPreview');
    if (!preview) return;
    if (!origem || !destino) { preview.textContent = ''; return; }
    if (normalizeName(origem) === normalizeName(destino)) {
      preview.textContent = 'Escolhe nomes diferentes.';
      return;
    }
    const count = countRegistosByName(origem);
    preview.textContent = count + ' registo' + (count === 1 ? '' : 's') + ' de "' + origem + '" → "' + destino + '"';
  }

  function onFundirNomes() {
    const origem = $('#fundirOrigem').value;
    const destino = $('#fundirDestino').value;
    if (!origem || !destino) { flash('#fundirMsg', 'err', 'Escolhe os dois nomes.'); return; }
    if (normalizeName(origem) === normalizeName(destino)) { flash('#fundirMsg', 'err', 'Os nomes têm de ser diferentes.'); return; }
    const count = countRegistosByName(origem);
    if (count === 0) { flash('#fundirMsg', 'err', 'Não há registos com esse nome.'); return; }
    if (!confirm('Vais unir ' + count + ' registo(s) de "' + origem + '" em "' + destino + '". Continuar?')) return;

    const originKey = normalizeName(origem);
    (store.state.registos || []).forEach(r => {
      if (r.nome && normalizeName(r.nome) === originKey) r.nome = destino;
      if (r.recebidoPor && normalizeName(r.recebidoPor) === originKey) r.recebidoPor = destino;
      if (r.ajudanteAssoc && normalizeName(r.ajudanteAssoc) === originKey) r.ajudanteAssoc = destino;
    });
    if (Array.isArray(store.state.oficiaisAjudantes)) {
      store.state.oficiaisAjudantes = store.state.oficiaisAjudantes.filter(n => normalizeName(n) !== originKey);
    }
    store.save();
    renderFundirNomes();
    renderPendentes();
    renderRegistos();
    flash('#fundirMsg', 'ok', count + ' registo(s) atualizado(s).');
  }

  function onGuardarValores() {
    const next = { ajudante: {}, oficial: {} };
    let bad = false;
    $$('#valTableBody input[type=number]').forEach((inp) => {
      const n = parseFloat(inp.value);
      if (isNaN(n) || n < 0) { bad = true; return; }
      next[inp.dataset.tipo][inp.dataset.meal] = Math.round(n * 100) / 100;
    });
    if (bad) { flash('#valoresMsg', 'err', 'Há valores inválidos. Use números iguais ou superiores a zero.'); return; }
    store.state.values = next;
    store.save();
    flash('#valoresMsg', 'ok', 'Valores guardados.');
  }

  function renderOficiaisList() {
    const list = store.state.oficiais.slice().sort((a, b) => a.localeCompare(b, 'pt'));
    const ajudantesSet = new Set((store.state.oficiaisAjudantes || []).map(normalizeName));
    $('#oficiaisList').innerHTML = list.length
      ? list.map((nome) => {
          const isAj = ajudantesSet.has(normalizeName(nome));
          return '<li><span class="nome">' + esc(nome) + '</span>' +
            '<label class="ofic-toggle"><input type="checkbox" data-role="toggle-ajudante" data-nome="' + esc(nome) + '"' + (isAj ? ' checked' : '') + '><span>Pode ser ajudante</span></label>' +
            '<button class="btn danger small" data-role="remover" data-nome="' + esc(nome) + '">Remover</button></li>';
        }).join('')
      : '<li><span class="nome" style="color:var(--ink-faint);font-style:italic">Sem oficiais na lista.</span></li>';
  }

  function renderOficiaisSelect() {
    const list = store.state.oficiais.slice().sort((a, b) => a.localeCompare(b, 'pt'));
    $('#nomeOficial').innerHTML = list.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
  }

  function onAddOficial() {
    const input = $('#novoOficial');
    const nome = input.value.trim().toUpperCase();
    if (!nome) return;
    if (store.state.oficiais.some((n) => n.toUpperCase() === nome)) {
      flash('#valoresMsg', 'err', 'Esse oficial já existe na lista.');
      return;
    }
    store.state.oficiais.push(nome);
    store.save();
    input.value = '';
    renderOficiaisSelect();
    renderOficiaisList();
  }

  let toastTimer = null;
  function toast(msg, duration) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    // Reflow so the transition applies from the hidden state.
    void el.offsetWidth;
    el.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => { el.hidden = true; }, 200);
    }, duration || 900);
  }

  function flash(sel, type, msg) {
    const el = $(sel);
    el.innerHTML = '<div class="alert ' + type + '" style="margin-top:var(--sp-4);margin-bottom:0">' + esc(msg) + '</div>';
    setTimeout(() => { if (el.firstChild) el.innerHTML = ''; }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Firebase Integration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDyjwD6ntoou7k_8oh2WsvCyBVgmmpxcww",
  authDomain: "despesassondalis.firebaseapp.com",
  databaseURL: "https://despesassondalis-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "despesassondalis",
  storageBucket: "despesassondalis.firebasestorage.app",
  messagingSenderId: "996267689145",
  appId: "1:996267689145:web:a87535fbe1ab553f9c0768",
  measurementId: "G-NYG8Z91Z1P"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const stateRef = ref(db, 'app_state/sdl_9k2xq7');

let isRemoteUpdate = false;

function sanitizeState(data) {
  if (!data) return { values: {}, oficiais: [], oficiaisAjudantes: [], registos: [] };

  const oficiaisArray = Array.isArray(data.oficiais)
    ? data.oficiais
    : (data.oficiais ? Object.values(data.oficiais) : []);

  const oficiaisAjudantesArray = Array.isArray(data.oficiaisAjudantes)
    ? data.oficiaisAjudantes
    : (data.oficiaisAjudantes ? Object.values(data.oficiaisAjudantes) : []);

  const registosArray = Array.isArray(data.registos)
    ? data.registos
    : (data.registos ? Object.values(data.registos) : []);

  return {
    values: data.values || {},
    oficiais: oficiaisArray,
    oficiaisAjudantes: oficiaisAjudantesArray,
    registos: registosArray
  };
}

function getLocalState() {
  if (window.store && window.store.state) {
    return window.store.state;
  }
  try {
    const raw = localStorage.getItem('sondalis_diarias_v1');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

async function safeInitSync() {
  const localData = getLocalState();

  try {
    const snapshot = await get(stateRef);
    const remoteData = snapshot.val();

    if (!remoteData && localData) {
      await set(stateRef, sanitizeState(localData));
    }
  } catch (err) {
    console.error("Erro na verificação inicial do Firebase:", err);
  }

  onValue(stateRef, (snapshot) => {
    const rawData = snapshot.val();
    const data = sanitizeState(rawData);

    const hoje = new Date().toISOString().slice(0, 10);
    if (data.registos && Array.isArray(data.registos)) {
      const tamInicial = data.registos.length;
      data.registos = data.registos.filter(r => {
        const dataChegada = r.regressoEfetivoData || r.regressoData;
        if (!dataChegada) return true;
        const [sy, sm, sd] = dataChegada.split('-').map(Number);
        const [ey, em, ed] = hoje.split('-').map(Number);
        const dias = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
        return dias <= 60;
      });

      if (data.registos.length < tamInicial) {
        set(stateRef, data).catch(e => console.error("Erro ao expurgar no Firebase:", e));
      }
    }

    isRemoteUpdate = true;
    localStorage.setItem('sondalis_diarias_v1', JSON.stringify(data));

    if (window.store) {
      window.store.state = data;
    }

    if (typeof renderOficiaisSelect === 'function') renderOficiaisSelect();
    if (typeof renderDefinicoes === 'function') renderDefinicoes();
    if (typeof renderPendentes === 'function') renderPendentes();
    if (typeof renderRegistos === 'function') renderRegistos();

    isRemoteUpdate = false;
  });
}

safeInitSync();

window.enviarSync = function() {
  if (isRemoteUpdate) return;

  const rawState = getLocalState();
  const cleanData = sanitizeState(rawState);

  set(stateRef, cleanData).catch((error) => console.error("Erro no envio para o Firebase:", error));
};
