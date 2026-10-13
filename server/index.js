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
   CLICAR CONTROLE
   ========================================================= */

async function clickText(page, text) {
  const locator = page.getByText(text, {
    exact: true
  });

  const count = await locator.count();

  if (!count) {
    return false;
  }

  for (let i = count - 1; i >= 0; i--) {
    try {
      const element = locator.nth(i);

      if (await element.isVisible()) {
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
   CLICAR MODO ETS2
   ========================================================= */

async function clickMode(page, mode) {

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

async function extractDistance(page) {

  await page.waitForTimeout(3000);

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

    for (const match of matches) {

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
     * ALL-TIME
     */

    if (
      period === "alltime"
    ) {

      const allTime =
        await clickText(
          page,
          "All-time"
        );

      console.log(
        "ALL-TIME:",
        allTime
      );

      await page.waitForTimeout(
        3000
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


    /*
     * NÃO ENCONTROU
     */

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


  /*
   * GUILHERME REAL
   */

  const guilhermeReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      player:
        players.guilherme
    });


  /*
   * GUILHERME RACE
   */

  const guilhermeRace =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "race",
      player:
        players.guilherme
    });


  /*
   * FANTASMA REAL
   */

  const fantasmaReal =
    await readPlayerStats({
      browser,
      period: "alltime",
      mode: "real",
      player:
        players.fantasma
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


    const monthly =
      await getMonthly();


    let alltime;


    try {

      alltime =
        await getAllTime(
          browser
        );

    } catch (error) {

      console.error(
        "ERRO AO BUSCAR ALL-TIME:"
      );

      console.error(
        error.message
      );


      /*
       * Se já existir informação anterior,
       * mantém os dados antigos em vez
       * de apagar o resultado da API.
       */

      if (
        cache &&
        cache.alltime
      ) {

        console.log(
          "Mantendo ALL-TIME anterior."
        );

        alltime =
          cache.alltime;

      } else {

        alltime = {

          guilherme: {
            km: null,
            mode: "Real + Race"
          },

          fantasma: {
            km: null,
            mode: "Real"
          }

        };

      }

    }


    const result = {

      updatedAt:
        new Date().toISOString(),

      monthLabel:
        getMonthLabel(),

      monthly,

      alltime,

      history:
        cache &&
        Array.isArray(cache.history)
          ? cache.history
          : []

    };


    /*
     * Adiciona histórico.
     */

    result.history.push({

      date:
        result.updatedAt,

      guilherme:
        result.monthly.guilherme.km,

      fantasma:
        result.monthly.fantasma.km

    });


    /*
     * Limita histórico.
     */

    if (
      result.history.length > 100
    ) {

      result.history =
        result.history.slice(-100);

    }


    cache =
      result;

    cacheAt =
      Date.now();


    /*
     * Salva no data.json
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
   * Se já existe uma atualização em andamento,
   * não abre outro Chromium.
   */

  if (refreshPromise) {

    console.log(
      "Atualização já está em andamento."
    );

    return refreshPromise;

  }


  /*
   * Usa cache se ainda estiver válido.
   */

  if (
    !force &&
    cache &&
    Date.now() - cacheAt < CACHE_MS
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
      JSON.parse(text);


    if (
      data &&
      typeof data === "object"
    ) {

      cache =
        data;

      /*
       * Não considera o arquivo antigo
       * como cache fresco.
       */

      cacheAt = 0;

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
        await refresh(force);


      res.json(data);

    } catch (error) {

      console.error(
        "API /api/stats:",
        error
      );


      /*
       * Se houver cache, devolve o cache.
       */

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
        await refresh(true);


      res.json(data);

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
   HEALTH CHECK
   ========================================================= */

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

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
   FALLBACK
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
