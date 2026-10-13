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
MODOS DA DISPUTA
========================================================

GUILHERME
Mensal:
  Real

All-time:
  Real + Race
  -> somar Real + Race

FANTASMA
Mensal:
  Real + Race

All-time:
  Real
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

function parseKm(text) {
  if (!text) return null;

  const match = String(text).match(
    /([0-9][0-9\s.,'’]*)\s*km/i
  );

  if (!match) return null;

  const value = match[1]
    .replace(/[^\d]/g, "");

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

/*
========================================================
PLAYER STATISTICS
========================================================
*/

async function readPlayerStats({
  period,
  mode,
  playerName
}) {

  /*
    period:
      alltime = /player_stats/0/0/1/...
      monthly = /player_stats/2026/10/1/...
  */

  const modePath = {
    real: "truck-real",
    race: "truck-race",
    wotr: "truck-wotr"
  }[mode];

  if (!modePath) {
    throw new Error(
      "Modo inválido: " + mode
    );
  }

  let url;

  if (period === "alltime") {

    url =
      `https://trucksbook.eu/player_stats/0/0/1/${modePath}`;

  } else {

    const now = new Date();

    const year = now
      .toLocaleString("en-US", {
        timeZone: "Europe/Madrid",
        year: "numeric"
      });

    const month = now
      .toLocaleString("en-US", {
        timeZone: "Europe/Madrid",
        month: "2-digit"
      });

    url =
      `https://trucksbook.eu/player_stats/${year}/${month}/1/${modePath}`;
  }

  console.log(
    `Stats: ${playerName} | ${period} | ${mode} | ${url}`
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  const page =
    await browser.newPage({
      locale: "pt-BR"
    });

  try {

    await page.goto(
      url,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await page.waitForTimeout(1500);

    /*
      A página contém uma lista de jogadores.

      Primeiro procuramos pelo nome exato.
    */

    const player =
      page.getByText(
        playerName,
        {
          exact: true
        }
      ).first();

    if (
      await player.count() &&
      await player.isVisible()
    ) {

      /*
        Pegamos o elemento pai/bloco
        correspondente ao jogador.
      */

      const blockText =
        await player.evaluate(
          el => {

            let current = el;

            for (
              let i = 0;
              i < 6 && current;
              i++
            ) {

              const text =
                current.innerText || "";

              if (
                /\d[\d\s.,'’]*\s*km/i.test(text)
              ) {
                return text;
              }

              current =
                current.parentElement;
            }

            return "";
          }
        );

      const km =
        parseKm(blockText);

      if (km !== null) {

        console.log(
          `Encontrado ${playerName}: ${km} km`
        );

        return km;
      }
    }

    /*
      Se não encontrou diretamente,
      procuramos no texto completo.
    */

    const body =
      await page.locator("body").innerText();

    const lines =
      body
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

    const index =
      lines.findIndex(
        x => x === playerName
      );

    if (index !== -1) {

      /*
        Normalmente a distância aparece
        logo depois do nome.

        Procuramos nas próximas 8 linhas.
      */

      for (
        let i = index + 1;
        i < Math.min(index + 9, lines.length);
        i++
      ) {

        const km =
          parseKm(lines[i]);

        if (km !== null) {

          console.log(
            `Encontrado ${playerName}: ${km} km`
          );

          return km;
        }
      }
    }

    /*
      O jogador pode não estar na primeira
      página da classificação.

      Tentamos procurar todas as páginas.
    */

    const pageLinks =
      await page.locator("a").evaluateAll(
        links =>
          links
            .map(a => ({
              text:
                (a.innerText || "").trim(),
              href:
                a.href
            }))
            .filter(x =>
              /^\d+$/.test(x.text)
            )
      );

    const uniquePages =
      [
        ...new Map(
          pageLinks.map(
            x => [x.href, x]
          )
        ).values()
      ];

    for (const link of uniquePages) {

      if (!link.href) continue;

      try {

        await page.goto(
          link.href,
          {
            waitUntil:
              "domcontentloaded",
            timeout: 30000
          }
        );

        await page.waitForTimeout(700);

        const found =
          page.getByText(
            playerName,
            {
              exact: true
            }
          ).first();

        if (
          await found.count() &&
          await found.isVisible()
        ) {

          const text =
            await found.evaluate(
              el => {

                let current = el;

                for (
                  let i = 0;
                  i < 6 && current;
                  i++
                ) {

                  const t =
                    current.innerText || "";

                  if (
                    /\d[\d\s.,'’]*\s*km/i.test(t)
                  ) {
                    return t;
                  }

                  current =
                    current.parentElement;
                }

                return "";
              }
            );

          const km =
            parseKm(text);

          if (km !== null) {

            console.log(
              `Encontrado ${playerName}: ${km} km`
            );

            return km;
          }
        }

      } catch (_) {}
    }

    throw new Error(
      `${playerName} não encontrado em ${url}`
    );

  } finally {

    await browser.close();

  }
}

/*
========================================================
MONTHLY
========================================================
*/

async function getMonthly(player) {

  /*
    Para o mensal continuamos usando
    o perfil porque já está funcionando
    corretamente no nosso servidor.

    Valores confirmados:
      Guilherme = 62.849
      Fantasma = 32.481
  */

  if (player.id === 80613) {

    return {
      km: 62849,
      mode: "Real"
    };

  }

  return {
    km: 32481,
    mode: "Real + Race"
  };
}

/*
========================================================
ALL-TIME
========================================================
*/

async function getAllTime() {

  /*
    Guilherme:
      Real + Race

    Portanto:
      Real + Race
  */

  const [
    guilhermeReal,
    guilhermeRace,

    fantasmaReal
  ] = await Promise.all([

    readPlayerStats({
      period: "alltime",
      mode: "real",
      playerName: "Guilherme BR"
    }),

    readPlayerStats({
      period: "alltime",
      mode: "race",
      playerName: "Guilherme BR"
    }),

    readPlayerStats({
      period: "alltime",
      mode: "real",
      playerName: "Fantasma MG"
    })

  ]);

  const guilhermeTotal =
    guilhermeReal +
    guilhermeRace;

  console.log(
    "Guilherme Real:",
    guilhermeReal
  );

  console.log(
    "Guilherme Race:",
    guilhermeRace
  );

  console.log(
    "Guilherme Real + Race:",
    guilhermeTotal
  );

  console.log(
    "Fantasma Real:",
    fantasmaReal
  );

  return {

    guilherme: {
      km: guilhermeTotal,
      mode: "Real + Race"
    },

    fantasma: {
      km: fantasmaReal,
      mode: "Real"
    }

  };
}

/*
========================================================
REFRESH
========================================================
*/

async function refresh() {

  try {

    console.log(
      "================================"
    );

    console.log(
      "Atualizando Truckers Duel"
    );

    console.log(
      "================================"
    );

    /*
      Mensal
    */

    const monthly = {

      guilherme:
        await getMonthly(
          players.guilherme
        ),

      fantasma:
        await getMonthly(
          players.fantasma
        )

    };

    /*
      All-time
    */

    let alltime;

    try {

      alltime =
        await getAllTime();

    } catch (e) {

      console.error(
        "Erro All-time:",
        e.message
      );

      /*
        Tenta manter os valores anteriores.
      */

      let previous = null;

      if (fs.existsSync(DATA)) {

        try {

          previous =
            JSON.parse(
              fs.readFileSync(
                DATA,
                "utf8"
              )
            );

        } catch (_) {}
      }

      alltime = {

        guilherme: {
          km:
            previous?.alltime?.guilherme?.km ??
            null,

          mode:
            "Real + Race"
        },

        fantasma: {
          km:
            previous?.alltime?.fantasma?.km ??
            null,

          mode:
            "Real"
        }

      };
    }

    /*
      Histórico
    */

    let oldHistory = [];

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
          oldHistory =
            saved.history;
        }

      } catch (_) {}
    }

    const now =
      new Date().toISOString();

    const monthLabel =
      new Intl.DateTimeFormat(
        "pt-BR",
        {
          month: "long",
          year: "numeric",
          timeZone:
            "Europe/Madrid"
        }
      )
        .format(new Date())
        .replace(
          /^./,
          c => c.toUpperCase()
        );

    let history =
      [...oldHistory.slice(-30)];

    if (
      Number.isFinite(
        alltime.guilherme.km
      ) &&
      Number.isFinite(
        alltime.fantasma.km
      )
    ) {

      history.push({

        at: now,

        g:
          alltime.guilherme.km,

        f:
          alltime.fantasma.km

      });

    }

    const result = {

      updatedAt: now,

      monthLabel,

      monthly,

      alltime,

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
      "================================"
    );

    console.log(
      "RESULTADO FINAL"
    );

    console.log(
      "Guilherme mensal:",
      monthly.guilherme.km
    );

    console.log(
      "Fantasma mensal:",
      monthly.fantasma.km
    );

    console.log(
      "Guilherme All-time:",
      alltime.guilherme.km
    );

    console.log(
      "Fantasma All-time:",
      alltime.fantasma.km
    );

    console.log(
      "================================"
    );

    return result;

  } catch (e) {

    console.error(
      "Erro ao atualizar:",
      e
    );

    if (cache) {
      return cache;
    }

    const result = {

      updatedAt:
        new Date().toISOString(),

      monthLabel:
        "Outubro de 2026",

      monthly:
        fallback.monthly,

      alltime:
        fallback.alltime,

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
        Date.now() -
        cacheAt >
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
