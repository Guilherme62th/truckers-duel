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
    name: "Guilherme BR"
  },

  fantasma: {
    id: 321853,
    name: "Fantasma MG"
  }
};

let cache = null;
let cacheAt = 0;


/* =========================================================
   UTILIDADES
========================================================= */

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


function getMonthParts() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit"
    }
  );

  const parts = formatter.formatToParts(now);

  const year =
    parts.find(p => p.type === "year")?.value;

  const month =
    parts.find(p => p.type === "month")?.value;

  return {
    year,
    month
  };
}


function getMonthLabel() {
  return new Intl.DateTimeFormat(
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
}


/* =========================================================
   ENCONTRAR KM DE UM JOGADOR NA PÁGINA
========================================================= */

async function extractPlayerKm(page, playerName) {

  /*
   * Primeiro tenta encontrar o link do jogador.
   */
  const playerLink =
    page.getByRole("link", {
      name: playerName,
      exact: true
    }).first();

  if (
    await playerLink.count() > 0
  ) {

    const result =
      await playerLink.evaluate(el => {

        let current = el;

        for (
          let i = 0;
          i < 8 && current;
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
      });

    const km =
      parseKm(result);

    if (km !== null) {
      return km;
    }
  }


  /*
   * Segunda tentativa:
   * procura o nome no texto da página e pega
   * os quilômetros das linhas seguintes.
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

    for (
      let i = index + 1;
      i < Math.min(index + 12, lines.length);
      i++
    ) {

      const km =
        parseKm(lines[i]);

      if (km !== null) {
        return km;
      }
    }
  }

  return null;
}


/* =========================================================
   SELECIONAR PLAYER NO FILTRO DO TRUCKERSBOOK
========================================================= */

async function selectPlayer(page, playerName) {

  const selects =
    await page.locator("select").evaluateAll(
      elements =>
        elements.map((select, index) => ({
          index,
          name:
            select.getAttribute("name") || "",
          id:
            select.id || "",
          options:
            Array.from(select.options).map(
              option => ({
                text:
                  (option.textContent || "").trim(),
                value:
                  option.value
              })
            )
        }))
    );

  console.log(
    "Selects encontrados:",
    selects.map(s => ({
      index: s.index,
      name: s.name,
      id: s.id,
      options: s.options.length
    }))
  );


  /*
   * Procura o select que contém o jogador.
   */

  const playerSelect =
    selects.find(select =>
      select.options.some(
        option =>
          option.text === playerName ||
          option.text.includes(playerName)
      )
    );

  if (!playerSelect) {

    console.log(
      "Não encontrei o jogador no select:",
      playerName
    );

    /*
     * Mostra alguns nomes disponíveis para diagnóstico.
     */
    for (const select of selects) {

      console.log(
        "Select:",
        select.name || select.id || select.index
      );

      console.log(
        select.options
          .slice(0, 10)
          .map(x => x.text)
      );
    }

    return false;
  }


  const option =
    playerSelect.options.find(
      option =>
        option.text === playerName
    ) ||
    playerSelect.options.find(
      option =>
        option.text.includes(playerName)
    );


  console.log(
    `Selecionando ${playerName}:`,
    option
  );


  const locator =
    page.locator("select").nth(
      playerSelect.index
    );


  /*
   * Seleciona pelo VALUE.
   */

  await locator.selectOption(
    option.value
  );


  /*
   * Clica em Confirm.
   */

  const confirm =
    page.getByRole("button", {
      name: /confirm/i
    }).first();


  if (
    await confirm.count() > 0
  ) {

    console.log(
      "Clicando em Confirm..."
    );

    await Promise.all([
      confirm.click(),

      page.waitForLoadState(
        "domcontentloaded"
      ).catch(() => {})
    ]);

    await page.waitForTimeout(1500);

    return true;
  }


  /*
   * Caso o botão não seja encontrado,
   * tenta localizar pelo texto.
   */

  const button =
    page.locator("button")
      .filter({
        hasText: /confirm/i
      })
      .first();

  if (
    await button.count() > 0
  ) {

    await button.click();

    await page.waitForTimeout(1500);

    return true;
  }


  console.log(
    "Botão Confirm não encontrado."
  );

  return false;
}


/* =========================================================
   CONSULTAR ESTATÍSTICA DO PLAYER
========================================================= */

async function readPlayerStats({
  period,
  mode,
  playerName
}) {

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

    const {
      year,
      month
    } = getMonthParts();

    url =
      `https://trucksbook.eu/player_stats/${year}/${month}/1/${modePath}`;
  }


  console.log(
    "--------------------------------"
  );

  console.log(
    "TruckersBook:",
    playerName
  );

  console.log(
    "Período:",
    period
  );

  console.log(
    "Modo:",
    mode
  );

  console.log(
    "URL:",
    url
  );


  const browser =
    await chromium.launch({
      headless: true
    });


  const context =
    await browser.newContext({
      locale: "pt-BR"
    });


  const page =
    await context.newPage();


  try {

    await page.goto(
      url,
      {
        waitUntil: "domcontentloaded",
        timeout: 45000
      }
    );


    await page.waitForTimeout(1500);


    /*
     * IMPORTANTE:
     *
     * O filtro Players pode estar presente
     * mesmo que o jogador não esteja na página atual.
     */

    const selected =
      await selectPlayer(
        page,
        playerName
      );


    if (selected) {

      console.log(
        "Filtro aplicado."
      );

      await page.waitForTimeout(1200);
    }


    /*
     * Agora procura o jogador.
     */

    const km =
      await extractPlayerKm(
        page,
        playerName
      );


    if (km !== null) {

      console.log(
        `SUCESSO: ${playerName} = ${km} km`
      );

      return km;
    }


    /*
     * Última tentativa:
     * procura links de perfil que tenham
     * o ID do jogador.
     */

    const profileLinks =
      await page.locator("a").evaluateAll(
        (links, targetId) =>
          links
            .map(a => ({
              text:
                (a.innerText || "").trim(),
              href:
                a.href
            }))
            .filter(
              x =>
                x.href &&
                x.href.includes(
                  `/profile/${targetId}`
                )
            ),
        playerName === "Guilherme BR"
          ? 80613
          : 321853
      );


    if (profileLinks.length) {

      console.log(
        "Link de perfil encontrado:",
        profileLinks[0]
      );

      const profile =
        profileLinks[0];

      const profilePage =
        await context.newPage();

      await profilePage.goto(
        profile.href,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 45000
        }
      );

      await profilePage.waitForTimeout(
        1500
      );

      const profileText =
        await profilePage.locator(
          "body"
        ).innerText();

      const profileKm =
        parseKm(profileText);

      if (profileKm !== null) {

        await profilePage.close();

        console.log(
          `Encontrado pelo perfil: ${profileKm} km`
        );

        return profileKm;
      }

      await profilePage.close();
    }


    /*
     * Salva uma pequena parte do HTML/texto
     * no log para podermos diagnosticar se
     * o TrucksBook mudar novamente.
     */

    const debugText =
      await page.locator("body").innerText();

    console.log(
      "Jogador não encontrado."
    );

    console.log(
      "Trecho da página:",
      debugText.slice(0, 3000)
    );


    throw new Error(
      `${playerName} não encontrado em ${url}`
    );

  } finally {

    await browser.close();
  }
}


/* =========================================================
   MENSAL
========================================================= */

async function getMonthly() {

  /*
   * Neste momento usamos os valores que já
   * foram confirmados diretamente no TrucksBook.
   *
   * Outubro/2026:
   * Guilherme = Real
   * Fantasma = Real + Race
   */

  return {

    guilherme: {
      km: 62849,
      mode: "Real"
    },

    fantasma: {
      km: 32481,
      mode: "Real + Race"
    }

  };
}


/* =========================================================
   ALL-TIME
========================================================= */

async function getAllTime() {

  console.log(
    "================================"
  );

  console.log(
    "BUSCANDO ALL-TIME"
  );

  console.log(
    "================================"
  );


  /*
   * Guilherme:
   *
   * All-time Real
   * +
   * All-time Race
   */

  const [
    guilhermeReal,
    guilhermeRace,
    fantasmaReal
  ] = await Promise.all([

    readPlayerStats({
      period: "alltime",
      mode: "real",
      playerName:
        players.guilherme.name
    }),

    readPlayerStats({
      period: "alltime",
      mode: "race",
      playerName:
        players.guilherme.name
    }),

    readPlayerStats({
      period: "alltime",
      mode: "real",
      playerName:
        players.fantasma.name
    })

  ]);


  const guilhermeTotal =
    guilhermeReal +
    guilhermeRace;


  console.log(
    "================================"
  );

  console.log(
    "ALL-TIME ENCONTRADO"
  );

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

  console.log(
    "================================"
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


/* =========================================================
   ATUALIZAÇÃO
========================================================= */

async function refresh() {

  console.log(
    "================================"
  );

  console.log(
    "ATUALIZANDO TRUCKERS DUEL"
  );

  console.log(
    new Date().toISOString()
  );

  console.log(
    "================================"
  );


  const monthly =
    await getMonthly();


  let alltime;


  try {

    alltime =
      await getAllTime();

  } catch (error) {

    console.error(
      "ERRO NO ALL-TIME:"
    );

    console.error(
      error.message
    );


    /*
     * Se já temos um valor válido salvo,
     * preservamos esse valor.
     */

    let previous = null;


    if (
      fs.existsSync(DATA)
    ) {

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
          Number.isFinite(
            previous?.alltime?.guilherme?.km
          )
            ? previous.alltime.guilherme.km
            : null,

        mode:
          "Real + Race"

      },


      fantasma: {

        km:
          Number.isFinite(
            previous?.alltime?.fantasma?.km
          )
            ? previous.alltime.fantasma.km
            : null,

        mode:
          "Real"

      }

    };

  }


  /*
   * Histórico
   */

  let oldHistory = [];


  if (
    fs.existsSync(DATA)
  ) {

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


  let history =
    [
      ...oldHistory.slice(-30)
    ];


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

    updatedAt:
      now,

    monthLabel:
      getMonthLabel(),

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


  cache =
    result;

  cacheAt =
    Date.now();


  console.log(
    "================================"
  );

  console.log(
    "RESULTADO"
  );

  console.log(
    "Mensal Guilherme:",
    monthly.guilherme.km
  );

  console.log(
    "Mensal Fantasma:",
    monthly.fantasma.km
  );

  console.log(
    "All-time Guilherme:",
    alltime.guilherme.km
  );

  console.log(
    "All-time Fantasma:",
    alltime.fantasma.km
  );

  console.log(
    "================================"
  );


  return result;
}


/* =========================================================
   API
========================================================= */

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

    } catch (error) {

      console.error(
        error
      );

      res.status(503).json({

        error:
          error.message

      });

    }

  }
);


/* =========================================================
   FRONTEND
========================================================= */

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


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      "Truckers Duel listening on " +
      PORT
    );

  }
);
