import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ABRIGO_PLAYWRIGHT_MODULE || 'playwright');
const url = new URL('../index.html', import.meta.url).href;
let browser;

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.ABRIGO_CHROMIUM || undefined,
    args: ['--disable-logging']
  });
});
after(() => browser?.close());

async function withPage(run, options = {}) {
  const page = await browser.newPage(options);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function startGame(page) {
  await page.locator('#menu-new').click();
  await page.locator('#menu-scenario-start').click();
  await page.locator('#pause').click();
}

test('opções de campanha, texto grande e código do mapa em celular', async () => {
  await withPage(async page => {
    await page.locator('#large-text').check();
    assert.equal(await page.locator('body').getAttribute('data-large-text'), '');
    await page.locator('#menu-new').click();
    await page.locator('#menu-difficulty').selectOption('hard');
    await page.locator('#menu-map-code').fill('TESTE-ABRIGO');
    await page.locator('#menu-scenario-start').click();
    assert.deepEqual(await page.evaluate(() => [state.difficulty, state.mapCode]), ['hard', 'TESTE-ABRIGO']);
    await page.locator('#menu-button').click();
    assert.match(await page.locator('#menu-save-detail').textContent(), /Severa.*TESTE-ABRIGO/);
    await page.locator('#menu-new').click();
    await page.locator('#menu-ruins').check();
    await page.locator('#menu-scenario-start').click();
    await page.locator('#menu-start').click();
    assert(await page.evaluate(() => state.world.some(tile => tile.site === 'ruins' && tile.ruins.page)));
  }, { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
});

test('mundo repetível, diferenças de dificuldade e migração das especializações redundantes', async () => {
  await withPage(async page => {
    const result = await page.evaluate(() => {
      const first = fresh('dry', { mapCode: 'REPETIR-1' });
      const second = fresh('dry', { mapCode: 'REPETIR-1' });
      const other = fresh('dry', { mapCode: 'REPETIR-2' });
      const demands = ['story', 'normal', 'hard'].map(difficulty => {
        reset(null, false, 'normal', { difficulty });
        return supplyRates().costs.water;
      });
      const old = fresh();
      old.rooms[5] = 'salaEstudos';
      old.works[6] = { type: 'briefing', remaining: 12, total: 36 };
      old.duties[0] = 'soldagem';
      old.duties[1] = 'triagem';
      old.experience[0] = { soldagem: 80, mecanica: 30, rastreio: 26 };
      old.research.projects.salaEstudos = { researcher: null, left: 40 };
      const migrated = decodeColony(old);
      return { same: JSON.stringify(first.world) === JSON.stringify(second.world),
        different: JSON.stringify(first.world) !== JSON.stringify(other.world),
        demands, building: migrated.rooms[5], work: migrated.works[6].type,
        skills: migrated.duties, xp: migrated.experience[0],
        refunded: migrated.resources.materials, retired: ['briefing', 'simulador', 'costura', 'salaEstudos'].some(unlocked) };
    });
    assert(result.same && result.different && !result.retired);
    assert(result.demands[0] < result.demands[1] && result.demands[1] < result.demands[2]);
    assert.deepEqual([result.building, result.work], ['biblioteca', 'cartografia']);
    assert.deepEqual(result.skills, { 0: 'mecanica', 1: 'cuidado' });
    assert.deepEqual(result.xp, { mecanica: 110, busca: 26 });
    assert.equal(result.refunded, 60);
  });
});

test('obras, bateria dedicada e acordo de cama de emergência', async () => {
  await withPage(async page => {
    await startGame(page);
    const result = await page.evaluate(() => {
      state.quietUntil = 9999;
      paused = false;
      startRoomUpgrade(0);
      const queued = state.works[0]?.upgrade === 2 && roomLevel(0) === 1;
      for (let i = 0; i < 100 && state.works[0]; i++) tick();
      paused = true;
      state.rooms[6] = 'enfermaria';
      state.roomLevels[6] = 3;
      state.roomSpecialties[6] = 'trauma';
      state.roomBackups[6] = 6;
      state.grid.care = 'off';
      gridDispatch = null;
      const output = supplyRates(weather(), true);
      const backup = gridDispatch.backupLoads.has(6) && !gridDispatch.poweredLots.has(4) && state.roomBackups[6] < 6;
      state.rooms[5] = 'quarto';
      state.people = 6;
      state.colonyPacts.bed = { status: 'active', minimum: 1 };
      state.gate = { name: 'Teste', sick: false, profession: 'transporte', until: state.clock + 60 };
      renderGate();
      const healthyBlocked = byId('gate-accept').disabled;
      state.gate.sick = true;
      renderGate();
      return [queued, roomLevel(0), backup, output.effects.health > 0, healthyBlocked, !byId('gate-accept').disabled];
    });
    assert.deepEqual(result, [true, 2, true, true, true, true]);
  });
});

test('um mecânico melhora a produção apenas no local onde trabalha', async () => {
  await withPage(async page => {
    await startGame(page);
    const result = await page.evaluate(() => {
      const yard = outsideStart;
      state.rooms[5] = 'oficina';
      state.rooms[yard] = 'sucata';
      state.duties[0] = 'mecanica';
      gridDispatch = null;
      const worker = walkers[0];
      const place = lot => {
        worker.destination = lotDestination(lot, 0, 'mecanica');
        worker.x = worker.destination.x;
        worker.level = worker.destination.level;
      };
      const read = () => [runProduction(false).workshopBonus, supplyRates().income.materials];
      const base = read();
      place(5);
      const workshop = read();
      place(yard);
      return { base, workshop, yard: read() };
    });
    assert.equal(result.base[0], 0);
    assert(result.workshop[0] > 0);
    assert.equal(result.yard[0], 0);
    assert(result.yard[1] > result.base[1]);
  });
});

test('duas coletas, desvio e carga depositada respeitam a capacidade', async () => {
  await withPage(async page => {
    await startGame(page);
    const result = await page.evaluate(() => {
      const first = baseTile + 1, original = baseTile + 2, alternative = baseTile + mapWidth + 1;
      const stop = baseTile + mapWidth;
      for (const id of [first, original, alternative, stop]) Object.assign(state.world[id], { scouted: true, visited: false, site: 'factory' });
      state.outposts[stop] = { stock: { food: 10, water: 10, materials: 0 } };
      siteSelected = first;
      partyPicks.add(0);
      partyPicks.add(1);
      renderDispatch();
      byId('mission-focus').value = 'supplies';
      renderDispatch();
      byId('route-post').value = String(stop);
      byId('route-target').value = String(original);
      byId('route-drop').checked = true;
      const route = planDispatch(first, [0, 1], 'supplies', null);
      sendExpedition();
      const mission = state.missions[0];
      mission.encounter = { status: 'waiting', returnLeg: 25 };
      const option = [...(renderFieldMessage(), byId('field-choices').children)].find(button => button.textContent ===
        'Trocar segundo destino por ' + sectorName(alternative));
      option.click();
      state.clock = mission.returns;
      const before = state.resources.materials;
      const originalRandom = Math.random;
      Math.random = () => .99;
      try { finishExpeditions(); } finally { Math.random = originalRandom; }
      return { planned: route.extraTile === original && route.dropPost === stop,
        visited: state.world[first].visited && state.world[alternative].visited && !state.world[original].visited,
        stock: state.outposts[stop].stock.materials,
        total: state.resources.materials - before + state.outposts[stop].stock.materials, load: mission.load };
    });
    assert(result.planned && result.visited && result.stock > 0);
    assert(result.total <= result.load);
  });
});

test('um caminho de acolhimento continua viável nas três dificuldades e nos quatro cenários', async () => {
  await withPage(async page => {
    await startGame(page);
    const outcomes = await page.evaluate(() => Object.keys(difficulties).flatMap(difficulty => Object.keys(scenarios).map((scenario, index) => {
      let seed = 100 + index;
      const random = Math.random;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      try {
        reset(null, false, scenario, { difficulty });
        chooseLegacy('shelter');
        const opening = { normal: ['oficina', 'gerador', 'horta', 'cisterna'],
          dry: ['cisterna', 'oficina', 'gerador', 'horta'],
          winter: ['horta', 'gerador', 'oficina', 'caldeira', 'cisterna'],
          outpost: ['oficina', 'horta', 'gerador', 'cisterna'] };
        const queue = [...opening[scenario], 'escada', 'quarto', 'quarto', 'triagem', 'enfermaria', 'recreacao',
          'cozinha', 'cisterna', 'horta', 'gerador', 'dreno', 'deposito'];
        for (let i = 0; i < 34 * 144 && !state.ended && !state.legacy.completed.length; i++) {
          const type = queue[0];
          if (type && state.resources.materials >= rooms[type].cost) {
            const lot = slots.findIndex((slot, id) => !state.rooms[id] && !state.works[id] && canPlace(type, slot));
            queueConstruction(lot, queue.shift());
          }
          tick();
          if (state.incident) {
            const option = state.incident.template.options.find(canChoose);
            if (option) resolveIncident(option);
          }
          if (state.gate) {
            if (state.people < 8 && freeBeds() > 0 && state.resources.food >= gateCost() + 12) resolveVisitor('accept');
            else if (state.people >= 8 || state.gate.until - state.clock <= 2) resolveVisitor('decline');
          }
          if (state.raid && !byId('raid-seal').disabled) byId('raid-seal').click();
          if (state.legacy.finale?.phase === 'choice') startLegacyFinale('shelter', 'shifts');
          if (state.legacy.finale?.phase === 'ready') completeLegacy('shelter');
          for (const [lot, leak] of Object.entries(state.leaks)) if (!leak.task) {
            const worker = homeWorkers().find(id => !state.oddJobs[id] && canReachLot(walkers.find(w => w.id === id), lot));
            if (worker !== undefined) assignLeakWork(lot, 'seal', worker);
          }
        }
        return { scenario, difficulty, health: state.health, day: day(), completed: state.legacy.completed.includes('shelter') };
      } finally {
        Math.random = random;
      }
    })));
    assert(outcomes.every(({ completed, health }) => completed && health >= 80), JSON.stringify(outcomes));
  });
});

test('famílias e intercâmbios sobrevivem à exportação e recarga da partida', async () => {
  await withPage(async page => {
    await startGame(page);
    const result = await page.evaluate(() => {
      state.profiles = { 0: { name: 'Lia', sex: 'female' }, 1: { name: 'Nina', sex: 'female' },
        2: { name: 'Caio', sex: 'male' }, 3: { name: 'Ravi', sex: 'male' } };
      const pair = (a, b) => ({ people: [a, b], couple: true });
      state.bonds = { '0:1': pair(0, 1), '1:2': pair(1, 2) };
      state.rooms[5] = 'quarto';
      state.rooms[6] = 'bercario';
      state.familyPlans = { '0:1': { status: 'wish' }, '1:2': { status: 'wish' } };
      supportFamily('0:1');
      supportFamily('1:2');
      const plans = [state.familyPlans['0:1'].status, state.familyPlans['1:2'].status];
      state.neighbors.village = { trust: 3 };
      const ui = renderExchange('village');
      ui.querySelector('select').value = '3';
      ui.querySelector('button').click();
      const exportSave = JSON.parse(JSON.stringify(portableSave()));
      reset(decodeColony(exportSave.colony), false);
      const away = !residentsAtHome().includes(3);
      const guest = workerWeight([], 'mecanica');
      state.clock = state.exchange.until;
      updateNeighbors();
      return { plans, away, guest, returned: residentsAtHome().includes(3), family: state.familyPlans['1:2'].status,
        romance: state.bonds['0:1'].couple, format: exportSave.format };
    });
    assert.deepEqual(result, { plans: ['wish', 'expecting'], away: true, guest: 1, returned: true,
      family: 'expecting', romance: true, format: 'abrigo' });
  });
});

test('dois aparelhos enviam, recebem e resolvem divergências sem sobrescrever automaticamente', async () => {
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  let remote = { revision: 0, snapshot: null };
  const api = (method, data) => {
    if (method === 'GET') return { status: 200, body: remote };
    if (data.revision !== remote.revision) return { status: 409, body: {} };
    remote = { revision: remote.revision + 1, snapshot: data.snapshot };
    return { status: 200, body: { revision: remote.revision } };
  };
  const connect = async page => {
    await page.locator('#menu-sync').click();
    await page.locator('#cloud-address').fill('https://sincronizacao.invalid');
    await page.locator('#cloud-token').fill('b'.repeat(64));
    await page.locator('#cloud-connect').click();
  };
  try {
    for (const page of pages) {
      await page.exposeFunction('mockCloud', api);
      await page.addInitScript(() => {
        window.fetch = async (_url, options) => {
          const response = await window.mockCloud(options.method, options.body ? JSON.parse(options.body) : null);
          return new Response(JSON.stringify(response.body), { status: response.status });
        };
      });
      await page.goto(url);
    }
    const [first, second] = pages;
    await startGame(first);
    await first.locator('#menu-button').click();
    await connect(first);
    await first.waitForFunction(() => cloud?.revision === 1);
    await connect(second);
    await second.waitForFunction(() => cloud?.revision === 1 && campaignStarted);
    const advance = (page, materials) => page.evaluate(async count => {
      state.resources.materials = count;
      saveColony();
      await syncColony();
    }, materials);
    await advance(second, 32);
    assert.equal(JSON.parse(remote.snapshot).resources.materials, 32);
    await advance(first, 28);
    assert(await first.locator('#cloud-conflict').isVisible());
    assert.equal(JSON.parse(remote.snapshot).resources.materials, 32);
    await first.locator('#cloud-use-remote').click();
    await first.waitForFunction(() => !cloudConflict && state.resources.materials === 32);
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
});
