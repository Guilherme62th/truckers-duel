const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_MS = 60 * 60 * 1000;
const DATA_FILE = path.join(__dirname, "data.json");

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

  const matches = String(text).match(
    /([0-9][0-9\s.,'’]*)\s*km/gi
  );

  if (!matches || !matches.length) {
    return null;
  }

  for (const match of matches) {
    const number = match
      .replace(/km/i, "")
      .replace(/[^\d]/g, "");

    const value = Number(number);

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}


function getMonthParts() {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit"
    }
  ).formatToParts(new Date());

  return {
    year: parts.find(x => x.type === "year").value,
    month: parts.find(x => x.type === "month").value
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
    .replace(/^./, x => x.toUpperCase());
}


/* =========================================================
   EXAMINA CONTROLES DO TRUCKERSBOOK
========================================================= */

async function inspectControls(page) {

  const controls = await page.evaluate(() => {

    const result = [];

    const elements = document.querySelectorAll(
      "select, input, button, [role='combobox'], [role='listbox']"
    );

    for (const el of elements) {

      const rect = el.getBoundingClientRect();

      result.push({
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        id: el.id || "",
        name: el.getAttribute("name") || "",
        value: el.value || "",
        text: (el.innerText || "").trim().slice(0, 300),
        aria:
          el.getAttribute("aria-label") || "",
        placeholder:
          el.getAttribute("placeholder") || "",
        class:
          el.className?.toString().slice(0, 300) || "",
        visible:
          rect.width > 0 &&
          rect.height > 0
      });
    }

    return result;
  });

  console.log("========== CONTROLES ==========");

  console.log(
    JSON.stringify(
      controls,
      null,
      2
    )
  );

  return controls;
}


/* =========================================================
   PROCURA CONTROLE DO PLAYER
========================================================= */

async function selectPlayer(
  page,
  player
) {

  console.log(
    `PROCURANDO JOGADOR: ${player.name} (${player.id})`
  );


  /*
   * Primeiro inspecionamos todos os controles.
   */

  const controls =
    await inspectControls(page);


  /*
   * Procura elementos que contenham:
   *
   * Guilherme BR
   * Fantasma MG
   * 80613
   * 321853
   */

  const candidate =
    await page.evaluate(
      ({ name, id }) => {

        const text =
          document.body.innerText || "";

        const all =
          Array.from(
            document.querySelectorAll("*")
          );

        const found = [];

        for (const el of all) {

          const value =
            (
              el.textContent ||
              ""
            ).trim();

          if (!value) continue;

          if (
            value === name ||
            value.includes(name) ||
            value.includes(String(id))
          ) {

            const rect =
              el.getBoundingClientRect();

            found.push({
              tag: el.tagName,
              id: el.id || "",
              name:
                el.getAttribute("name") || "",
              value:
                el.getAttribute("value") || "",
              role:
                el.getAttribute("role") || "",
              text:
                value.slice(0, 500),
              html:
                el.outerHTML.slice(0, 1500),
              visible:
                rect.width > 0 &&
                rect.height > 0
            });
          }
        }

        return {
          bodyHasName:
            text.includes(name),

          bodyHasId:
            text.includes(String(id)),

          found:
            found.slice(0, 30)
        };

      },
      {
        name: player.name,
        id: player.id
      }
    );


  console.log(
    "========== CANDIDATOS PLAYER =========="
  );

  console.log(
    JSON.stringify(
      candidate,
      null,
      2
    )
  );


  /*
   * =======================================================
   * SELECT NATIVO
   * =======================================================
   */

  const selects =
    await page.locator("select").all();


  for (const select of selects) {

    const options =
      await select.locator("option").all();


    for (const option of options) {

      const text =
        (
          await option.innerText()
        ).trim();


      const value =
        await option.getAttribute(
          "value"
        );


      if (
        text === player.name ||
        text.includes(player.name) ||
        value === String(player.id) ||
        value?.includes(String(player.id))
      ) {

        console.log(
          "PLAYER ENCONTRADO EM SELECT:",
          text,
          value
        );


        await select.selectOption(
          value
        );


        return true;
      }
    }
  }


  /*
   * =======================================================
   * INPUT
   * =======================================================
   */

  const inputs =
    await page.locator("input").all();


  for (const input of inputs) {

    const value =
      await input.getAttribute("value");

    const name =
      await input.getAttribute("name");

    const id =
      await input.getAttribute("id");

    const type =
      await input.getAttribute("type");


    if (
      value === player.name ||
      value === String(player.id) ||
      name === "player" ||
      name === "player_id" ||
      name === "playerId" ||
      id === "player" ||
      id === "player_id" ||
      id === "playerId"
    ) {

      console.log(
        "INPUT PLAYER ENCONTRADO:",
        {
          id,
          name,
          value,
          type
        }
      );


      await input.fill(
        String(player.id)
      );


      return true;
    }
  }


  /*
   * =======================================================
   * COMBOBOX / SELECT2 / BOOTSTRAP
   * =======================================================
   */

  const combo =
    page.locator(
      "[role='combobox']"
    );


  const comboCount =
    await combo.count();


  for (
    let i = 0;
    i < comboCount;
    i++
  ) {

    const el =
      combo.nth(i);


    const text =
      (
        await el.innerText()
      ).trim();


    const aria =
      await el.getAttribute(
        "aria-label"
      );


    const placeholder =
      await el.getAttribute(
        "placeholder"
      );


    console.log(
      "COMBOBOX:",
      {
        text,
        aria,
        placeholder
      }
    );


    if (
      /player|jogador/i.test(
        `${text} ${aria} ${placeholder}`
      )
    ) {

      console.log(
        "COMBOBOX DO PLAYER ENCONTRADO"
      );


      await el.click();


      await page.waitForTimeout(
        500
      );


      /*
       * Procura o nome depois que o dropdown abriu.
       */

      const option =
        page.getByText(
          player.name,
          {
            exact: true
          }
        ).last();


      if (
        await option.count() > 0
      ) {

        await option.click();

        return true;
      }


      /*
       * Procura pelo ID.
       */

      const idOption =
        page.getByText(
          String(player.id),
          {
            exact: true
          }
        ).last();


      if (
        await idOption.count() > 0
      ) {

        await idOption.click();

        return true;
      }
    }
  }


  /*
   * =======================================================
   * BOTÕES / DROPDOWNS
   * =======================================================
   */

  const buttons =
    page.locator(
      "button"
    );


  const buttonCount =
    await buttons.count();


  for (
    let i = 0;
    i < buttonCount;
    i++
  ) {

    const button =
      buttons.nth(i);


    const text =
      (
        await button.innerText()
      ).trim();


    if (
      /player|jogador/i.test(text)
    ) {

      console.log(
        "BOTÃO PLAYER:",
        text
      );


      await button.click();

      await page.waitForTimeout(
        500
      );


      const option =
        page.getByText(
          player.name,
          {
            exact: true
          }
        ).last();


      if (
        await option.count() > 0
      ) {

        await option.click();

        return true;
      }
    }
  }


  console.log(
    "NÃO CONSEGUI SELECIONAR O PLAYER."
  );

  return false;
}


/* =========================================================
   CONFIRM
========================================================= */

async function confirmPlayer(page) {

  const confirm =
    page.getByRole(
      "button",
      {
        name: "Confirm",
        exact: true
      }
    );


  if (
    await confirm.count() === 0
  ) {

    console.log(
      "BOTÃO CONFIRM NÃO ENCONTRADO."
    );

    return false;
  }


  console.log(
    "CLICANDO CONFIRM..."
  );


  const beforeUrl =
    page.url();


  const requests = [];


  const requestHandler =
    request => {

      if (
        request.method() !== "GET" ||
        request.resourceType() ===
          "document"
      ) {

        requests.push({
          method:
            request.method(),

          url:
            request.url(),

          postData:
            request.postData()
        });

      }
    };


  page.on(
    "request",
    requestHandler
  );


  try {

    await Promise.race([

      confirm.click(),

      page.waitForTimeout(
        10000
      )

    ]);

  } finally {

    page.off(
      "request",
      requestHandler
    );

  }


  await page.waitForTimeout(
    2500
  );


  console.log(
    "URL ANTES:",
    beforeUrl
  );

  console.log(
    "URL DEPOIS:",
    page.url()
  );


  console.log(
    "REQUESTS DO CONFIRM:"
  );

  console.log(
    JSON.stringify(
      requests,
      null,
      2
    )
  );


  return true;
}


/* =========================================================
   EXTRAI KM
========================================================= */

async function extractPlayerKm(
  page,
  playerName
) {

  /*
   * Primeiro tenta linhas de tabela.
   */

  const rows =
    page.locator("tr");


  const rowCount =
    await rows.count();


  for (
    let i = 0;
    i < rowCount;
    i++
  ) {

    const row =
      rows.nth(i);


    const text =
      (
        await row.innerText()
      ).trim();


    if (
      text.includes(playerName)
    ) {

      console.log(
        "LINHA DO PLAYER:"
      );

      console.log(
        text
      );


      const km =
        parseKm(text);


      if (km !== null) {
        return km;
      }
    }
  }


  /*
   * Procura blocos próximos ao nome.
   */

  const body =
    await page.locator(
      "body"
    ).innerText();


  const lines =
    body
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean);


  const index =
    lines.findIndex(
      x =>
        x === playerName ||
        x.includes(playerName)
    );


  if (index >= 0) {

    for (
      let i = index;
      i < Math.min(
        index + 20,
        lines.length
      );
      i++
    ) {

      const km =
        parseKm(lines[i]);

      if (km !== null) {

        console.log(
          "KM ENCONTRADO:",
          km
        );

        return km;
      }
    }
  }


  /*
   * Última tentativa: procura link do perfil.
   */

  const profile =
    page.locator(
      `a[href*="/profile/"]`
    );


  const profileCount =
    await profile.count();


  for (
    let i = 0;
    i < profileCount;
    i++
  ) {

    const link =
      profile.nth(i);


    const text =
      (
        await link.innerText()
      ).trim();


    if (
      text.includes(playerName)
    ) {

      const parentText =
        await link.evaluate(
          el => {

            let p = el;

            for (
              let i = 0;
              i < 6 && p;
              i++
            ) {

              const t =
                p.innerText || "";

              if (
                /\d[\d\s.,'’]*\s*km/i.test(
                  t
                )
              ) {
                return t;
              }

              p =
                p.parentElement;
            }

            return "";
          }
        );


      const km =
        parseKm(parentText);


      if (km !== null) {
        return km;
      }
    }
  }


  console.log(
    `KM NÃO ENCONTRADO PARA ${playerName}`
  );

  return null;
}


/* =========================================================
   READ STATS
========================================================= */

async function readPlayerStats({
  browser,
  period,
  mode,
  player
}) {

  const modePath = {
    real: "truck-real",
    race: "truck-race"
  }[mode];


  const url =
    period === "alltime"
      ? `https://trucksbook.eu/player_stats/0/0/1/${modePath}`
      : (() => {

          const {
            year,
            month
          } = getMonthParts();

          return `https://trucksbook.eu/player_stats/${year}/${month}/1/${modePath}`;

        })();


  console.log(
    "======================================"
  );

  console.log(
    "TRUCKERSBOOK"
  );

  console.log(
    "Jogador:",
    player.name
  );

  console.log(
    "ID:",
    player.id
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

  console.log(
    "======================================"
  );


  const page =
    await browser.newPage({
      locale: "pt-BR"
    });


  try {

    await page.goto(
      url,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );


    await page.waitForTimeout(
      5000
    );


    /*
     * Tenta selecionar o jogador.
     */

    const selected =
      await selectPlayer(
        page,
        player
      );


    if (selected) {

      console.log(
        "PLAYER SELECIONADO."
      );


      await confirmPlayer(
        page
      );

    } else {

      console.log(
        "PLAYER NÃO FOI SELECIONADO."
      );
    }


    await page.waitForTimeout(
      3000
    );


    const km =
      await extractPlayerKm(
        page,
        player.name
      );


    if (km !== null) {

      console.log(
        `RESULTADO ${player.name}: ${km} KM`
      );

      return km;
    }


    /*
     * Se não achou, mostra URL final e trecho da página.
     */

    console.log(
      "URL FINAL:",
      page.url()
    );


    const body =
      await page.locator(
        "body"
      ).innerText();


    console.log(
      "TRECHO FINAL DA PÁGINA:"
    );

    console.log(
      body.slice(0, 6000)
    );


    throw new Error(
      `Não foi possível obter KM de ${player.name}`
    );


  } finally {

    await page.close();

  }
}


/* =========================================================
   MONTHLY
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
    "######################################"
  );

  console.log(
    "BUSCANDO ALL-TIME"
  );

  console.log(
    "######################################"
  );


  const guilhermeReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      player: players.guilherme
    });


  const guilhermeRace =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "race",
      player: players.guilherme
    });


  const fantasmaReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      player: players.fantasma
    });


  return {

    guilherme: {
      km:
        guilhermeReal +
        guilhermeRace,

      mode:
        "Real + Race"
    },

    fantasma: {
      km:
        fantasmaReal,

      mode:
        "Real"
    }

  };
}


/* =========================================================
   REFRESH
========================================================= */

async function refresh() {

  console.log(
    "ATUALIZANDO TRUCKERS DUEL"
  );

  console.log(
    new Date().toISOString()
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


      let previous = null;


      if (
        fs.existsSync(DATA_FILE)
      ) {

        try {

          previous =
            JSON.parse(
              fs.readFileSync(
                DATA_FILE,
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


  let history = [];


  if (
    fs.existsSync(DATA_FILE)
  ) {

    try {

      const old =
        JSON.parse(
          fs.readFileSync(
            DATA_FILE,
            "utf8"
          )
        );


      if (
        Array.isArray(
          old.history
        )
      ) {

        history =
          old.history;

      }

    } catch (_) {}

  }


  if (
    Number.isFinite(
      alltime.guilherme.km
    ) &&
    Number.isFinite(
      alltime.fantasma.km
    )
  ) {

    history.push({
      at:
        new Date().toISOString(),

      g:
        alltime.guilherme.km,

      f:
        alltime.fantasma.km
    });


    history =
      history.slice(-30);
  }


  const result = {

    updatedAt:
      new Date().toISOString(),

    monthLabel:
      getMonthLabel(),

    monthly,

    alltime,

    history

  };


  fs.writeFileSync(
    DATA_FILE,
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
    "======================================"
  );

  console.log(
    "RESULTADO FINAL"
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
    "======================================"
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


      res.json(
        cache
      );

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
      `Truckers Duel listening on ${PORT}`
    );

  }
);
