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
  MODOS CORRETOS:

  Guilherme:
    Mensal    = Real
    All-time  = Real + Race

  Fantasma:
    Mensal    = Real + Race
    All-time  = Real
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

function numberFrom(s) {
  return Number(
    String(s).replace(/[^\d]/g, "")
  );
}

async function clickMode(page, type) {
  /*
    O TrucksBook pode apresentar os modos
    como:

      Real
      Race
      Real + Race
      All

    Para nossa comparação NÃO usamos "All".
  */

  if (type === "Real + Race") {
    const buttons = [
      page.getByText("Real + Race", { exact: true }).first(),
      page.getByText("Real+Race", { exact: true }).first()
    ];

    for (const button of buttons) {
      try {
        if (await button.isVisible()) {
          await button.click();
          await page.waitForTimeout(700);
          return;
        }
      } catch (_) {}
    }
  }

  if (type === "Real") {
    try {
      const button = page.getByText("Real", {
        exact: true
      }).first();

      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(700);
        return;
      }
    } catch (_) {}
  }

  if (type === "Race") {
    try {
      const button = page.getByText("Race", {
        exact: true
      }).first();

      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(700);
        return;
      }
    } catch (_) {}
  }
}

async function extract(page, period, type) {

  /*
    Seleciona Monthly ou All-time.
  */

  try {
    const periodButton = page
      .getByText(period, { exact: true })
      .first();

    if (await periodButton.isVisible()) {
      await periodButton.click();
      await page.waitForTimeout(800);
    }
  } catch (_) {}

  /*
    Seleciona ETS2.
  */

  try {
    const ets2 = page
      .getByText("ETS2", { exact: true })
      .first();

    if (await ets2.isVisible()) {
      await ets2.click();
      await page.waitForTimeout(700);
    }
  } catch (_) {}

  /*
    Seleciona o modo correto.
  */

  await clickMode(page, type);

  /*
    Aguarda o carregamento da estatística.
  */

  await page.waitForTimeout(1200);

  const text = await page.locator("body").innerText();

  /*
    Procura:

      Distance XXXXX km

    ou variações de espaçamento.
  */

  const matches = [
    ...text.matchAll(
      /Distance\s+([0-9][0-9 .,'\u202f]*)\s*km/gi
    )
  ]
    .map(match => numberFrom(match[1]))
    .filter(Number.isFinite);

  if (!matches.length) {
    throw new Error(
      "Distância ETS2 não encontrada após selecionar " +
      period +
      " / " +
      type
    );
  }

  return Math.max(...matches);
}

async function scrapePlayer(p) {

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    locale: "pt-BR"
  });

  try {

    await page.goto(p.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(1200);

    /*
      ============================
      MENSAL
      ============================

      Guilherme = Real
      Fantasma  = Real + Race
    */

    const monthlyType =
      p.id === 80613
        ? "Real"
        : "Real + Race";

    /*
      ============================
      ALL-TIME
      ============================

      Guilherme = Real + Race
      Fantasma  = Real
    */

    const alltimeType =
      p.id === 80613
        ? "Real + Race"
        : "Real";

    const monthly = await extract(
      page,
      "Monthly",
      monthlyType
    );

    const alltime = await extract(
      page,
      "All-time",
      alltimeType
    );

    return {
      monthly,
      alltime
    };

  } finally {

    await browser.close();

  }
}

async function refresh() {

  try {

    console.log(
      "Atualizando dados do TrucksBook..."
    );

    const [g, f] = await Promise.all([
      scrapePlayer(players.guilherme),
      scrapePlayer(players.fantasma)
    ]);

    let old = [];

    /*
      Recupera histórico anterior.
    */

    if (fs.existsSync(DATA)) {

      try {

        const saved = JSON.parse(
          fs.readFileSync(DATA, "utf8")
        );

        if (Array.isArray(saved.history)) {
          old = saved.history;
        }

      } catch (_) {

        old = [];

      }
    }

    const now = new Date().toISOString();

    const monthLabel =
      new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "Europe/Madrid"
      })
        .format(new Date())
        .replace(
          /^./,
          c => c.toUpperCase()
        );

    const result = {

      updatedAt: now,

      monthLabel,

      monthly: {

        guilherme: {
          km: g.monthly,
          mode: "Real"
        },

        fantasma: {
          km: f.monthly,
          mode: "Real + Race"
        }

      },

      alltime: {

        guilherme: {
          km: g.alltime,
          mode: "Real + Race"
        },

        fantasma: {
          km: f.alltime,
          mode: "Real"
        }

      },

      history: [

        ...old.slice(-30),

        {
          at: now,
          g: g.alltime,
          f: f.alltime
        }

      ]

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
      "TrucksBook atualizado com sucesso."
    );

    console.log(
      "Guilherme mensal:",
      g.monthly
    );

    console.log(
      "Fantasma mensal:",
      f.monthly
    );

    console.log(
      "Guilherme all-time:",
      g.alltime
    );

    console.log(
      "Fantasma all-time:",
      f.alltime
    );

    return result;

  } catch (e) {

    console.error(
      "Erro ao atualizar dados do TrucksBook:",
      e.message
    );

    /*
      Se já existe cache válido,
      mantém os dados anteriores.
    */

    if (cache) {
      return cache;
    }

    /*
      Primeiro carregamento sem sucesso:
      usamos somente os dados mensais
      que sabemos que estão corretos.

      NÃO inventamos números de All-time.
    */

    const now =
      new Date().toISOString();

    const result = {

      updatedAt: now,

      monthLabel:
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
          ),

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

app.get(
  "/api/stats",
  async (req, res) => {

    try {

      if (
        !cache ||
        Date.now() - cacheAt > CACHE_MS
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

app.listen(
  PORT,
  () => {

    console.log(
      "Truckers Duel listening on " +
      PORT
    );

  }
);
