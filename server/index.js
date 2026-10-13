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

  return {
    year: parts.find(p => p.type === "year")?.value,
    month: parts.find(p => p.type === "month")?.value
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
    .replace(/^./, c => c.toUpperCase());
}


/* =========================================================
   EXTRAI DADOS DA PÁGINA
========================================================= */

async function inspectPage(page, playerName) {

  console.log(
    "ANALISANDO ESTRUTURA DO TRUCKERSBOOK..."
  );

  const info = await page.evaluate(() => {

    const forms = Array.from(
      document.querySelectorAll("form")
    ).map((form, index) => ({
      index,
      action: form.action,
      method: form.method,
      id: form.id,
      name: form.getAttribute("name") || "",
      text: (form.innerText || "").slice(0, 1000)
    }));


    const selects = Array.from(
      document.querySelectorAll("select")
    ).map((select, index) => ({
      index,
      name: select.name || "",
      id: select.id || "",
      value: select.value || "",
      options: Array.from(select.options).map(option => ({
        text: (option.textContent || "").trim(),
        value: option.value
      }))
    }));


    const buttons = Array.from(
      document.querySelectorAll(
        "button, input[type=submit], input[type=button]"
      )
    ).map((button, index) => ({
      index,
      tag: button.tagName,
      type: button.getAttribute("type") || "",
      name: button.getAttribute("name") || "",
      value: button.getAttribute("value") || "",
      text:
        (
          button.innerText ||
          button.value ||
          ""
        ).trim()
    }));


    return {
      url: location.href,
      title: document.title,
      forms,
      selects,
      buttons
    };

  });


  console.log(
    "===== FORMS ====="
  );

  console.log(
    JSON.stringify(
      info.forms,
      null,
      2
    )
  );


  console.log(
    "===== SELECTS ====="
  );

  console.log(
    JSON.stringify(
      info.selects,
      null,
      2
    )
  );


  console.log(
    "===== BUTTONS ====="
  );

  console.log(
    JSON.stringify(
      info.buttons,
      null,
      2
    )
  );


  /*
   * Procuramos o jogador diretamente no HTML.
   */

  const foundPlayer =
    await page.evaluate(
      (name) => {

        const elements =
          Array.from(
            document.querySelectorAll("*")
          );

        const element =
          elements.find(
            el =>
              (
                el.textContent || ""
              ).trim() === name
          );

        if (!element) {
          return null;
        }

        let current = element;

        for (
          let i = 0;
          i < 8 && current;
          i++
        ) {

          const text =
            current.innerText || "";

          const km =
            text.match(
              /([0-9][0-9\s.,'’]*)\s*km/i
            );

          if (km) {
            return {
              text,
              html:
                current.outerHTML.slice(
                  0,
                  3000
                )
            };
          }

          current =
            current.parentElement;
        }

        return {
          text:
            element.innerText || "",
          html:
            element.outerHTML.slice(
              0,
              3000
            )
        };

      },
      playerName
    );


  console.log(
    "===== PLAYER ====="
  );

  console.log(
    JSON.stringify(
      foundPlayer,
      null,
      2
    )
  );


  return {
    info,
    foundPlayer
  };
}


/* =========================================================
   EXTRAI KM DO JOGADOR
========================================================= */

async function extractPlayerKm(
  page,
  playerName
) {

  /*
   * 1 — Link exato
   */

  const playerLink =
    page.getByRole("link", {
      name: playerName,
      exact: true
    }).first();


  if (
    await playerLink.count() > 0
  ) {

    const text =
      await playerLink.evaluate(
        el => {

          let current = el;

          for (
            let i = 0;
            i < 8 && current;
            i++
          ) {

            const value =
              current.innerText || "";

            if (
              /\d[\d\s.,'’]*\s*km/i.test(
                value
              )
            ) {
              return value;
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
      return km;
    }
  }


  /*
   * 2 — Texto da página
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
      i < Math.min(
        index + 15,
        lines.length
      );
      i++
    ) {

      const km =
        parseKm(lines[i]);

      if (km !== null) {
        return km;
      }
    }
  }


  /*
   * 3 — Procura o nome e KM no mesmo bloco
   */

  const blocks =
    await page.locator(
      "tr, li, .card, .row"
    ).allInnerTexts();


  for (const block of blocks) {

    if (
      block.includes(playerName)
    ) {

      const km =
        parseKm(block);

      if (km !== null) {
        return km;
      }
    }
  }


  return null;
}


/* =========================================================
   CONSULTA
========================================================= */

async function readPlayerStats({
  browser,
  period,
  mode,
  playerName
}) {

  const modePath = {
    real: "truck-real",
    race: "truck-race"
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
    `CONSULTA: ${playerName}`
  );

  console.log(
    `Período: ${period}`
  );

  console.log(
    `Modo: ${mode}`
  );

  console.log(
    `URL: ${url}`
  );


  const page =
    await browser.newPage({
      locale: "pt-BR"
    });


  try {

    /*
     * Captura requisições POST/XHR para descobrir
     * como o filtro do TrucksBook funciona.
     */

    page.on(
      "request",
      request => {

        const method =
          request.method();

        if (
          method === "POST" ||
          request.resourceType() ===
            "xhr" ||
          request.resourceType() ===
            "fetch"
        ) {

          console.log(
            "REQUEST:",
            method,
            request.url()
          );

          const data =
            request.postData();

          if (data) {

            console.log(
              "POST DATA:",
              data.slice(0, 2000)
            );
          }
        }
      }
    );


    page.on(
      "response",
      response => {

        const type =
          response.request().resourceType();

        if (
          type === "xhr" ||
          type === "fetch"
        ) {

          console.log(
            "RESPONSE:",
            response.status(),
            response.url()
          );
        }
      }
    );


    await page.goto(
      url,
      {
        waitUntil:
          "networkidle",
        timeout: 60000
      }
    );


    await page.waitForTimeout(
      2000
    );


    /*
     * Diagnóstico da página.
     */

    await inspectPage(
      page,
      playerName
    );


    /*
     * Primeiro tenta encontrar o jogador
     * sem mexer no formulário.
     */

    let km =
      await extractPlayerKm(
        page,
        playerName
      );


    if (km !== null) {

      console.log(
        `SUCESSO DIRETO: ${playerName} = ${km} km`
      );

      return km;
    }


    /*
     * Descobre automaticamente o select
     * que contém o jogador.
     */

    const playerSelect =
      page.locator(
        "select"
      ).filter({
        hasText: playerName
      }).first();


    if (
      await playerSelect.count() > 0
    ) {

      console.log(
        "SELECT DO JOGADOR ENCONTRADO."
      );


      const option =
        playerSelect
          .locator("option")
          .filter({
            hasText: playerName
          })
          .first();


      if (
        await option.count() > 0
      ) {

        const value =
          await option.getAttribute(
            "value"
          );


        console.log(
          "PLAYER VALUE:",
          value
        );


        await playerSelect.selectOption(
          value
        );


        /*
         * Procura botão Confirm.
         */

        const confirm =
          page.locator(
            "button, input[type=submit]"
          ).filter({
            hasText: /confirm/i
          }).first();


        if (
          await confirm.count() > 0
        ) {

          console.log(
            "CONFIRM ENCONTRADO."
          );


          await Promise.all([
            confirm.click(),
            page.waitForLoadState(
              "networkidle",
              {
                timeout: 30000
              }
            ).catch(() => {})
          ]);

        } else {

          console.log(
            "CONFIRM NÃO ENCONTRADO."
          );
        }


        await page.waitForTimeout(
          2000
        );


        km =
          await extractPlayerKm(
            page,
            playerName
          );


        if (km !== null) {

          console.log(
            `SUCESSO APÓS FILTRO: ${playerName} = ${km} km`
          );

          return km;
        }
      }
    }


    /*
     * Tenta encontrar links de perfil.
     */

    const profileId =
      playerName === "Guilherme BR"
        ? players.guilherme.id
        : players.fantasma.id;


    const profileLinks =
      await page.locator("a").evaluateAll(
        (links, id) =>
          links
            .map(a => ({
              text:
                (
                  a.innerText || ""
                ).trim(),
              href:
                a.href
            }))
            .filter(
              x =>
                x.href &&
                x.href.includes(
                  `/profile/${id}`
                )
            ),
        profileId
      );


    if (
      profileLinks.length > 0
    ) {

      console.log(
        "PROFILE LINK:",
        profileLinks[0]
      );

      const profilePage =
        await browser.newPage({
          locale: "pt-BR"
        });


      try {

        await profilePage.goto(
          profileLinks[0].href,
          {
            waitUntil:
              "networkidle",
            timeout: 60000
          }
        );


        await profilePage.waitForTimeout(
          2000
        );


        const text =
          await profilePage
            .locator("body")
            .innerText();


        console.log(
          "PROFILE TEXT:",
          text.slice(0, 5000)
        );


      } finally {

        await profilePage.close();

      }
    }


    /*
     * Salva HTML de diagnóstico.
     */

    const html =
      await page.content();


    console.log(
      "HTML LENGTH:",
      html.length
    );


    console.log(
      "PLAYER NÃO ENCONTRADO:",
      playerName
    );


    throw new Error(
      `${playerName} não encontrado`
    );


  } finally {

    await page.close();

  }
}


/* =========================================================
   MENSAL
========================================================= */

async function getMonthly() {

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

async function getAllTime(browser) {

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
   * IMPORTANTE:
   * Fazemos sequencialmente.
   * Não abrimos 3 Chromiums ao mesmo tempo.
   */

  const guilhermeReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      playerName:
        players.guilherme.name
    });


  const guilhermeRace =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "race",
      playerName:
        players.guilherme.name
    });


  const fantasmaReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      playerName:
        players.fantasma.name
    });


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
   REFRESH
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


  const browser =
    await chromium.launch({
      headless: true
    });


  try {

    try {

      alltime =
        await getAllTime(
          browser
        );

    } catch (error) {

      console.error(
        "ERRO NO ALL-TIME:"
      );

      console.error(
        error
      );


      /*
       * Recupera último valor válido.
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


  } finally {

    await browser.close();

  }


  /*
   * HISTÓRICO
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


  const history =
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
      g: alltime.guilherme.km,
      f: alltime.fantasma.km
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
