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

  if (!text) {
    return null;
  }

  const matches =
    String(text).match(
      /([0-9][0-9\s.,'’]*)\s*km/gi
    );

  if (!matches || !matches.length) {
    return null;
  }

  for (const match of matches) {

    const number =
      match
        .replace(/km/i, "")
        .replace(/[^\d]/g, "");

    const value =
      Number(number);

    if (
      Number.isFinite(value) &&
      value > 0
    ) {

      return value;

    }

  }

  return null;

}


/* =========================================================
   MÊS ATUAL
   ========================================================= */

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
      x => x.toUpperCase()
    );

}


/* =========================================================
   CLICAR TEXTO
   ========================================================= */

async function clickText(
  page,
  text
) {

  const locator =
    page.getByText(
      text,
      {
        exact: true
      }
    );

  const count =
    await locator.count();

  if (!count) {
    return false;
  }

  for (
    let i = count - 1;
    i >= 0;
    i--
  ) {

    try {

      const element =
        locator.nth(i);

      if (
        await element.isVisible()
      ) {

        await element.click();

        console.log(
          `CONTROLE CLICADO: ${text}`
        );

        return true;

      }

    } catch (_) {}

  }

  return false;

}


/* =========================================================
   CLICAR MODO
   ========================================================= */

async function clickMode(
  page,
  mode
) {

  const buttons =
    page.getByRole(
      "button",
      {
        name: mode,
        exact: true
      }
    );

  const count =
    await buttons.count();

  console.log(
    `BOTÕES ${mode}: ${count}`
  );

  for (
    let i = 0;
    i < count;
    i++
  ) {

    try {

      const button =
        buttons.nth(i);

      if (
        await button.isVisible()
      ) {

        await button.click();

        console.log(
          `MODO CLICADO: ${mode}`
        );

        return true;

      }

    } catch (_) {}

  }

  return false;

}


/* =========================================================
   EXTRAIR KM
   ========================================================= */

async function extractDistance(
  page
) {

  await page.waitForTimeout(
    3000
  );

  const body =
    await page
      .locator("body")
      .innerText();

  console.log(
    "PROCURANDO DISTÂNCIA..."
  );


  /*
   * Primeira tentativa:
   *
   * Distance 123 456 km
   */

  const distanceMatch =
    body.match(
      /Distance[\s\S]{0,100}?([0-9][0-9\s.,'’]*)\s*km/i
    );


  if (distanceMatch) {

    const km =
      Number(
        distanceMatch[1]
          .replace(/[^\d]/g, "")
      );

    if (
      Number.isFinite(km) &&
      km > 0
    ) {

      console.log(
        "DISTÂNCIA ENCONTRADA:",
        km
      );

      return km;

    }

  }


  /*
   * Segunda tentativa:
   * qualquer número seguido de km.
   */

  const matches =
    body.match(
      /([0-9][0-9\s.,'’]*)\s*km/gi
    );


  if (matches) {

    for (
      const match of matches
    ) {

      const number =
        match
          .replace(/km/i, "")
          .replace(/[^\d]/g, "");

      const km =
        Number(number);


      /*
       * Ignora valores muito pequenos.
       */

      if (
        Number.isFinite(km) &&
        km > 100
      ) {

        console.log(
          "KM ENCONTRADO POR FALLBACK:",
          km
        );

        return km;

      }

    }

  }


  return null;

}


/* =========================================================
   LER PERFIL DO JOGADOR
   ========================================================= */

async function readPlayerStats({
  browser,
  period,
  mode,
  player
}) {

  const url =
    `https://trucksbook.eu/profile/${player.id}`;


  console.log(
    "======================================"
  );

  console.log(
    "TRUCKERSBOOK — PERFIL"
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
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );


    await page.waitForTimeout(
      5000
    );


    /*
     * PERÍODO
     */

    if (
      period === "monthly"
    ) {

      const monthly =
        await clickText(
          page,
          "Monthly"
        );

      console.log(
        "MONTHLY:",
        monthly
      );

      await page.waitForTimeout(
        2000
      );

    }


    /*
     * ALL-TIME
     */

    if (
      period === "alltime"
    ) {

      const allTimeSelectors = [

        'button:has-text("All-time")',

        'a:has-text("All-time")',

        '[role="button"]:has-text("All-time")',

        'text=All-time'

      ];

      let allTimeClicked =
        false;


      for (
        const selector
        of allTimeSelectors
      ) {

        try {

          const locator =
            page.locator(
              selector
            );

          const count =
            await locator.count();

          console.log(
            `ALL-TIME selector ${selector}: ${count}`
          );


          for (
            let i = 0;
            i < count;
            i++
          ) {

            const element =
              locator.nth(i);

            if (
              await element.isVisible()
            ) {

              await element.click({
                force: true
              });

              allTimeClicked =
                true;

              console.log(
                `ALL-TIME CLICADO: ${selector}`
              );

              break;

            }

          }


          if (
            allTimeClicked
          ) {

            break;

          }

        } catch (error) {

          console.log(
            `Falhou selector ${selector}`
          );

        }

      }


      console.log(
        "ALL-TIME CLICADO:",
        allTimeClicked
      );


      await page.waitForTimeout(
        4000
      );

    }


    /*
     * ETS2 REAL / RACE
     */

    const selectedMode =
      await clickMode(
        page,
        mode === "race"
          ? "Race"
          : "Real"
      );


    console.log(
      "MODO SELECIONADO:",
      selectedMode
    );


    await page.waitForTimeout(
      4000
    );


    /*
     * EXTRAIR KM
     */

    const km =
      await extractDistance(
        page
      );


    if (
      Number.isFinite(km)
    ) {

      console.log(
        `RESULTADO ${player.name}: ${km} KM`
      );

      return km;

    }


    console.log(
      "======================================"
    );

    console.log(
      "KM NÃO ENCONTRADO"
    );

    console.log(
      "Jogador:",
      player.name
    );

    console.log(
      "URL FINAL:",
      page.url()
    );

    console.log(
      "======================================"
    );


    const body =
      await page
        .locator("body")
        .innerText();


    console.log(
      body.slice(
        0,
        10000
      )
    );


    throw new Error(
      `KM não encontrado para ${player.name}`
    );


  } finally {

    await page.close();

  }

}


/* =========================================================
   MONTHLY
   ========================================================= */

async function getMonthly(
  browser
) {

  console.log("");
  console.log(
    "######################################"
  );

  console.log(
    "BUSCANDO MENSAL NO TRUCKERSBOOK"
  );

  console.log(
    "######################################"
  );


  const guilhermeReal =
    await readPlayerStats({
      browser,

      period:
        "monthly",

      mode:
        "real",

      player:
        players.guilherme
    });


  const fantasmaReal =
    await readPlayerStats({
      browser,

      period:
        "monthly",

      mode:
        "real",

      player:
        players.fantasma
    });


  const fantasmaRace =
    await readPlayerStats({
      browser,

      period:
        "monthly",

      mode:
        "race",

      player:
        players.fantasma
    });


  return {

    guilherme: {

      km:
        guilhermeReal,

      mode:
        "Real"

    },

    fantasma: {

      km:
        fantasmaReal +
        fantasmaRace,

      mode:
        "Real + Race"

    }

  };

}
/* =========================================================
   ALL-TIME
   ========================================================= */

async function getAllTime(browser) {

  console.log("");
  console.log("######################################");
  console.log("BUSCANDO ALL-TIME");
  console.log("######################################");


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

let refreshPromise = null;


async function doRefresh() {

  console.log("");
  console.log("======================================");
  console.log("INICIANDO ATUALIZAÇÃO");
  console.log("======================================");


  let browser = null;


  try {

    browser =
      await chromium.launch({

        headless: true,

        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]

      });


    /*
     * Busca os valores mensais diretamente
     * do TrucksBook.
     */

    const monthly =
      await getMonthly(
        browser
      );


    /*
     * Os valores All-time informados pelo usuário.
     *
     * Guilherme: 3.993.778
     * Fantasma:  5.626.650
     *
     * Esses valores são a BASE.
     */


    const previous =
      cache &&
      cache.tracking
        ? cache.tracking
        : null;


    const currentMonth =
      getMonthLabel();


    let tracking;


    /*
     * Se já temos uma leitura anterior
     * no mesmo mês, calculamos somente
     * a diferença.
     */

    if (

      previous &&

      previous.monthLabel ===
        currentMonth &&

      Number.isFinite(
        previous.guilhermeMonthly
      ) &&

      Number.isFinite(
        previous.fantasmaMonthly
      ) &&

      Number.isFinite(
        previous.guilhermeAllTime
      ) &&

      Number.isFinite(
        previous.fantasmaAllTime
      )

    ) {


      let guilhermeDelta =
        monthly.guilherme.km -
        previous.guilhermeMonthly;


      let fantasmaDelta =
        monthly.fantasma.km -
        previous.fantasmaMonthly;


      /*
       * Nunca deixa o All-time diminuir.
       */

      if (
        guilhermeDelta < 0
      ) {

        guilhermeDelta = 0;

      }


      if (
        fantasmaDelta < 0
      ) {

        fantasmaDelta = 0;

      }


      tracking = {

        monthLabel:
          currentMonth,


        guilhermeMonthly:
          monthly.guilherme.km,


        fantasmaMonthly:
          monthly.fantasma.km,


        guilhermeAllTime:
          previous.guilhermeAllTime +
          guilhermeDelta,


        fantasmaAllTime:
          previous.fantasmaAllTime +
          fantasmaDelta

      };


      console.log(
        `GUILHERME DELTA: +${guilhermeDelta} km`
      );


      console.log(
        `FANTASMA DELTA: +${fantasmaDelta} km`
      );


    } else {


      /*
       * PRIMEIRA EXECUÇÃO
       *
       * Não soma o mensal atual.
       * Apenas cria o baseline.
       */

      tracking = {

        monthLabel:
          currentMonth,


        guilhermeMonthly:
          monthly.guilherme.km,


        fantasmaMonthly:
          monthly.fantasma.km,


        guilhermeAllTime:
          previous &&
          Number.isFinite(
            previous.guilhermeAllTime
          )

            ? previous.guilhermeAllTime

            : 3993778,


        fantasmaAllTime:
          previous &&
          Number.isFinite(
            previous.fantasmaAllTime
          )

            ? previous.fantasmaAllTime

            : 5626650

      };


      console.log(
        "BASELINE CRIADO."
      );

      console.log(
        "Nenhum km foi somado nesta leitura."
      );

    }


    const alltime = {

      guilherme: {

        km:
          tracking.guilhermeAllTime,

        mode:
          "Real + Race"

      },


      fantasma: {

        km:
          tracking.fantasmaAllTime,

        mode:
          "Real"

      }

    };


    const result = {

      updatedAt:
        new Date().toISOString(),


      monthLabel:
        currentMonth,


      monthly,


      alltime,


      tracking,


      history:
        cache &&
        Array.isArray(
          cache.history
        )

          ? cache.history

          : []

    };


    /*
     * Histórico.
     */

    result.history.push({

      date:
        result.updatedAt,


      guilherme:
        result.alltime.guilherme.km,


      fantasma:
        result.alltime.fantasma.km

    });


    /*
     * Máximo de 100 registros.
     */

    if (
      result.history.length > 100
    ) {

      result.history =
        result.history.slice(
          -100
        );

    }


    cache =
      result;


    cacheAt =
      Date.now();


    /*
     * Salva no data.json.
     */

    try {

      fs.writeFileSync(

        DATA_FILE,

        JSON.stringify(
          result,
          null,
          2
        ),

        "utf8"

      );


      console.log(
        "data.json atualizado."
      );


    } catch (error) {

      console.error(
        "Erro salvando data.json:",
        error.message
      );

    }


    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      "ATUALIZAÇÃO CONCLUÍDA"
    );

    console.log(
      "======================================"
    );


    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );


    return result;


  } finally {


    if (browser) {

      try {

        await browser.close();

      } catch (_) {}

    }

  }

}


/* =========================================================
   REFRESH COM PROTEÇÃO
   ========================================================= */

async function refresh(
  force = false
) {


  /*
   * Impede duas atualizações simultâneas.
   */

  if (refreshPromise) {

    console.log(
      "Atualização já está em andamento."
    );

    return refreshPromise;

  }


  /*
   * Cache.
   */

  if (

    !force &&

    cache &&

    Date.now() -
      cacheAt <
      CACHE_MS

  ) {

    console.log(
      "Usando cache."
    );

    return cache;

  }


  refreshPromise =
    doRefresh();


  try {

    return await refreshPromise;

  } finally {

    refreshPromise =
      null;

  }

}


/* =========================================================
   CARREGAR DATA.JSON
   ========================================================= */

function loadCache() {

  try {


    if (
      !fs.existsSync(
        DATA_FILE
      )
    ) {

      return;

    }


    const text =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );


    const data =
      JSON.parse(
        text
      );


    if (
      data &&
      typeof data ===
        "object"
    ) {

      cache =
        data;


      /*
       * O arquivo não é considerado
       * cache fresco.
       */

      cacheAt =
        0;


      console.log(
        "Cache inicial carregado."
      );

    }


  } catch (error) {

    console.error(
      "Erro carregando data.json:",
      error.message
    );

  }

}
/* =========================================================
   API
   ========================================================= */

app.get(
  "/api/stats",
  async (req, res) => {

    try {

      const force =
        req.query.refresh === "1" ||
        req.query.force === "1";


      const data =
        await refresh(
          force
        );


      res.json(
        data
      );


    } catch (error) {

      console.error(
        "API /api/stats:",
        error
      );


      if (cache) {

        return res.json(
          cache
        );

      }


      res.status(500).json({

        error:
          "Não foi possível obter os dados.",

        message:
          error.message

      });

    }

  }
);


/* =========================================================
   API REFRESH
   ========================================================= */

app.get(
  "/api/refresh",
  async (req, res) => {

    try {

      const data =
        await refresh(
          true
        );


      res.json(
        data
      );


    } catch (error) {

      console.error(
        "API /api/refresh:",
        error
      );


      res.status(500).json({

        error:
          "Erro ao atualizar.",

        message:
          error.message

      });

    }

  }
);


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok:
        true,

      service:
        "truckers-duel",

      time:
        new Date().toISOString()

    });

  }
);


/* =========================================================
   FRONTEND
   ========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "..",
      "public"
    )
  )
);


/* =========================================================
   FALLBACK EXPRESS 5
   ========================================================= */

app.get(
  "/{*splat}",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "..",
        "public",
        "index.html"
      )
    );

  }
);


/* =========================================================
   START
   ========================================================= */

loadCache();


app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      "TRUCKERS DUEL ONLINE"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "======================================"
    );

  }
);


/* =========================================================
   ATUALIZAÇÃO AUTOMÁTICA — 5 MINUTOS
   ========================================================= */

const AUTO_REFRESH_MS =
  5 * 60 * 1000;


setInterval(
  async () => {

    try {

      console.log("");
      console.log(
        "======================================"
      );

      console.log(
        "ATUALIZAÇÃO AUTOMÁTICA — 5 MINUTOS"
      );

      console.log(
        "======================================"
      );


      await refresh(
        true
      );


    } catch (error) {

      console.error(
        "Erro na atualização automática:",
        error.message
      );

    }

  },

  AUTO_REFRESH_MS
);
