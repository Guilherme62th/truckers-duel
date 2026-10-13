const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_MS = 60 * 60 * 1000;
const DATA = path.join(__dirname, "data.json");

app.use(express.static(path.join(__dirname, "../public")));

const players = {
  guilherme: {
    id: 80613,
    name: "Guilherme BR",
    url: "https://trucksbook.eu/profile/80613"
  },

  fantasma: {
    id: 321853,
    name: "Fantasma MG",
    url: "https://trucksbook.eu/profile/321853"
  }
};

let cache = null;
let cacheAt = 0;

/*
========================================================
CONFIGURAÇÃO DA DISPUTA
========================================================

Guilherme:
  Mensal   = Real
  All-time = Real + Race

Fantasma:
  Mensal   = Real + Race
  All-time = Real
========================================================
*/

const fallback = {
  monthly: {
    guilherme: {
      km: 62849,
      mode: "Real"
    },

    fantasma: {
      km: 32481,
      mode: "Real + Race"
    }
  },

  alltime: {
    guilherme: {
      km: null,
      mode: "Real + Race"
    },

    fantasma: {
      km: null,
      mode: "Real"
    }
  }
};

function numberFrom(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const n = Number(
    String(value).replace(/[^\d]/g, "")
  );

  return Number.isFinite(n) ? n : null;
}

function findNumbersDeep(obj, results = []) {
  if (obj === null || obj === undefined) {
    return results;
  }

  if (typeof obj === "number") {
    if (Number.isFinite(obj)) {
      results.push(obj);
    }

    return results;
  }

  if (typeof obj === "string") {
    const matches = obj.match(
      /\b\d[\d\s.,'’]*\s*(?:km|KM)\b/g
    );

    if (matches) {
      for (const m of matches) {
        const n = numberFrom(m);

        if (n !== null) {
          results.push(n);
        }
      }
    }

    return results;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findNumbersDeep(item, results);
    }

    return results;
  }

  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      findNumbersDeep(obj[key], results);
    }
  }

  return results;
}

function searchDistanceInText(text) {
  if (!text) {
    return [];
  }

  const patterns = [
    /Distance\s*:?\s*([0-9][0-9\s.,'’]*)\s*km/gi,
    /distance[^0-9]{0,30}([0-9][0-9\s.,'’]*)\s*km/gi,
    /([0-9][0-9\s.,'’]*)\s*km/gi
  ];

  const values = [];

  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      const n = numberFrom(match[1]);

      if (n !== null) {
        values.push(n);
      }
    }
  }

  return values;
}

async function clickVisible(page, text) {
  try {
    const locator = page
      .getByText(text, { exact: true })
      .first();

    if (await locator.count()) {
      if (await locator.isVisible()) {
        await locator.click();
        await page.waitForTimeout(1000);
        return true;
      }
    }
  } catch (_) {}

  return false;
}

async function selectPeriod(page, period) {
  try {
    const button = page
      .getByText(period, { exact: true })
      .first();

    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(1200);
      return true;
    }
  } catch (_) {}

  return false;
}

async function selectETS2(page) {
  try {
    const button = page
      .getByText("ETS2", { exact: true })
      .first();

    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(1000);
      return true;
    }
  } catch (_) {}

  return false;
}

async function selectMode(page, type) {
  /*
    Tentamos primeiro exatamente "Real + Race".
  */

  if (type === "Real + Race") {

    const names = [
      "Real + Race",
      "Real+Race",
      "Real / Race"
    ];

    for (const name of names) {
      if (await clickVisible(page, name)) {
        return true;
      }
    }
  }

  if (type === "Real") {
    if (await clickVisible(page, "Real")) {
      return true;
    }
  }

  if (type === "Race") {
    if (await clickVisible(page, "Race")) {
      return true;
    }
  }

  return false;
}

/*
========================================================
EXTRATOR POR DOM
========================================================
*/

async function extractFromDom(page) {

  const text = await page.locator("body").innerText();

  const values = searchDistanceInText(text);

  if (!values.length) {
    return null;
  }

  /*
    Normalmente haverá mais de uma distância
    na página. Pegamos a maior.
  */

  return Math.max(...values);
}

/*
========================================================
EXTRATOR DE RESPOSTAS DE REDE
========================================================
*/

async function extractFromResponses(responses) {

  const candidates = [];

  for (const response of responses) {

    try {

      const url = response.url();

      /*
        Só analisamos respostas que tenham
        alguma relação com estatísticas.
      */

      const interesting =
        /stat|profile|player|distance|truck|user/i.test(url);

      if (!interesting) {
        continue;
      }

      const contentType =
        response.headers()["content-type"] || "";

      if (
        !contentType.includes("json") &&
        !contentType.includes("javascript") &&
        !contentType.includes("text")
      ) {
        continue;
      }

      const body = await response.text();

      if (!body) {
        continue;
      }

      /*
        Primeiro tentamos JSON.
      */

      try {

        const json = JSON.parse(body);

        const numbers =
          findNumbersDeep(json);

        for (const n of numbers) {
          if (n > 1000) {
            candidates.push(n);
          }
        }

      } catch (_) {

        /*
          Se não for JSON,
          procuramos texto.
        */

        const numbers =
          searchDistanceInText(body);

        for (const n of numbers) {
          if (n > 1000) {
            candidates.push(n);
          }
        }
      }

    } catch (_) {}
  }

  if (!candidates.length) {
    return null;
  }

  return Math.max(...candidates);
}

/*
========================================================
EXTRAÇÃO PRINCIPAL
========================================================
*/

async function extract(page, period, type, responses) {

  console.log(
    `Selecionando ${period} / ETS2 / ${type}`
  );

  await selectPeriod(page, period);

  await selectETS2(page);

  await selectMode(page, type);

  /*
    Damos tempo para o TrucksBook fazer
    a requisição dinâmica.
  */

  await page.waitForTimeout(1800);

  /*
    Primeiro tentamos o DOM.
  */

  let value =
    await extractFromDom(page);

  if (value !== null) {

    console.log(
      `Encontrado no DOM: ${value} km`
    );

    return value;
  }

  /*
    Depois analisamos as respostas
    de rede capturadas.
  */

  value =
    await extractFromResponses(responses);

  if (value !== null) {

    console.log(
      `Encontrado na rede: ${value} km`
    );

    return value;
  }

  throw new Error(
    `Não foi possível encontrar distância para ${period} / ${type}`
  );
}

/*
========================================================
SCRAPER DO JOGADOR
========================================================
*/

async function scrapePlayer(player) {

  console.log(
    `Abrindo TrucksBook: ${player.name}`
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  const page =
    await browser.newPage({
      locale: "pt-BR"
    });

  const responses = [];

  page.on(
    "response",
    response => {

      const url = response.url();

      /*
        Guardamos somente respostas
        potencialmente relevantes.
      */

      if (
        /api|ajax|stat|profile|player|distance|truck|user/i
          .test(url)
      ) {
        responses.push(response);
      }
    }
  );

  try {

    await page.goto(
      player.url,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await page.waitForTimeout(1800);

    /*
      ==================================================
      MENSAL
      ==================================================
    */

    const monthlyType =
      player.id === 80613
        ? "Real"
        : "Real + Race";

    /*
      ==================================================
      ALL-TIME
      ==================================================
    */

    const alltimeType =
      player.id === 80613
        ? "Real + Race"
        : "Real";

    /*
      ==================================================
      MONTHLY
      ==================================================
    */

    let monthly = null;

    try {

      monthly =
        await extract(
          page,
          "Monthly",
          monthlyType,
          responses
        );

    } catch (e) {

      console.error(
        `${player.name} mensal:`,
        e.message
      );

    }

    /*
      ==================================================
      ALL-TIME
      ==================================================
    */

    let alltime = null;

    try {

      alltime =
        await extract(
          page,
          "All-time",
          alltimeType,
          responses
        );

    } catch (e) {

      console.error(
        `${player.name} all-time:`,
        e.message
      );

    }

    /*
      Se mensal falhar, usamos o valor conhecido
      somente para o mês atual.
    */

    if (monthly === null) {

      if (player.id === 80613) {
        monthly = fallback.monthly.guilherme.km;
      }

      if (player.id === 321853) {
        monthly = fallback.monthly.fantasma.km;
      }
    }

    return {
      monthly,
      alltime
    };

  } finally {

    await browser.close();

  }
}

/*
========================================================
REFRESH
========================================================
*/

async function refresh() {

  try {

    console.log(
      "======================================"
    );

    console.log(
      "Atualizando dados do TrucksBook..."
    );

    console.log(
      "======================================"
    );

    const [
      guilherme,
      fantasma
    ] = await Promise.all([

      scrapePlayer(
        players.guilherme
      ),

      scrapePlayer(
        players.fantasma
      )

    ]);

    /*
      Histórico existente.
    */

    let old = [];

    if (fs.existsSync(DATA)) {

      try {

        const saved =
          JSON.parse(
            fs.readFileSync(
              DATA,
              "utf8"
            )
          );

        if (
          Array.isArray(
            saved.history
          )
        ) {
          old = saved.history;
        }

      } catch (_) {

        old = [];

      }
    }

    const now =
      new Date().toISOString();

    const monthLabel =
      new Intl.DateTimeFormat(
        "pt-BR",
        {
          month: "long",
          year: "numeric",
          timeZone: "Europe/Madrid"
        }
      )
        .format(new Date())
        .replace(
          /^./,
          c => c.toUpperCase()
        );

    /*
      Se All-time ainda não foi encontrado,
      preservamos um valor válido anterior,
      se existir.

      NÃO inventamos valores.
    */

    let previousAlltime = {
      guilherme: null,
      fantasma: null
    };

    if (fs.existsSync(DATA)) {

      try {

        const previous =
          JSON.parse(
            fs.readFileSync(
              DATA,
              "utf8"
            )
          );

        previousAlltime.guilherme =
          previous?.alltime?.guilherme?.km ??
          null;

        previousAlltime.fantasma =
          previous?.alltime?.fantasma?.km ??
          null;

      } catch (_) {}
    }

    const guilhermeAlltime =
      guilherme.alltime ??
      previousAlltime.guilherme;

    const fantasmaAlltime =
      fantasma.alltime ??
      previousAlltime.fantasma;

    /*
      Histórico somente recebe ponto
      quando temos os dois All-time.
    */

    let history = [
      ...old.slice(-30)
    ];

    if (
      Number.isFinite(guilhermeAlltime) &&
      Number.isFinite(fantasmaAlltime)
    ) {

      history.push({
        at: now,
        g: guilhermeAlltime,
        f: fantasmaAlltime
      });

    }

    const result = {

      updatedAt: now,

      monthLabel,

      monthly: {

        guilherme: {
          km:
            guilherme.monthly ??
            fallback.monthly.guilherme.km,

          mode:
            "Real"
        },

        fantasma: {
          km:
            fantasma.monthly ??
            fallback.monthly.fantasma.km,

          mode:
            "Real + Race"
        }

      },

      alltime: {

        guilherme: {
          km: guilhermeAlltime,
          mode: "Real + Race"
        },

        fantasma: {
          km: fantasmaAlltime,
          mode: "Real"
        }

      },

      history

    };

    fs.writeFileSync(
      DATA,
      JSON.stringify(
        result,
        null,
        2
      )
    );

    cache = result;
    cacheAt = Date.now();

    console.log(
      "======================================"
    );

    console.log(
      "RESULTADO"
    );

    console.log(
      "Guilherme mensal:",
      result.monthly.guilherme.km
    );

    console.log(
      "Fantasma mensal:",
      result.monthly.fantasma.km
    );

    console.log(
      "Guilherme all-time:",
      result.alltime.guilherme.km
    );

    console.log(
      "Fantasma all-time:",
      result.alltime.fantasma.km
    );

    console.log(
      "======================================"
    );

    return result;

  } catch (e) {

    console.error(
      "Erro geral no TrucksBook:",
      e
    );

    /*
      Se já temos cache,
      mantemos o último resultado.
    */

    if (cache) {
      return cache;
    }

    /*
      Primeiro carregamento.
    */

    const now =
      new Date().toISOString();

    const result = {

      updatedAt: now,

      monthLabel:
        "Outubro de 2026",

      monthly: {
        ...fallback.monthly
      },

      alltime: {
        ...fallback.alltime
      },

      history: []

    };

    cache = result;
    cacheAt = Date.now();

    return result;
  }
}

/*
========================================================
API
========================================================
*/

app.get(
  "/api/stats",
  async (req, res) => {

    try {

      if (
        !cache ||
        Date.now() - cacheAt >
        CACHE_MS
      ) {

        await refresh();

      }

      res.json(cache);

    } catch (e) {

      res.status(503).json({
        error: e.message
      });

    }

  }
);

/*
========================================================
FRONTEND
========================================================
*/

app.get(
  "/{*splat}",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "../public/index.html"
      )
    );

  }
);

/*
========================================================
SERVER
========================================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      "Truckers Duel listening on " +
      PORT
    );

  }
);
