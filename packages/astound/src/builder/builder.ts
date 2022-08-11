/* eslint-disable no-template-curly-in-string */
/* eslint-disable indent */
/* eslint-disable implicit-arrow-linebreak */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Config, Plugin, TransformOutput } from '../../types';
import Client from '../plugins/client';
import { generateModule } from '../loader/loader';
import { error } from '../logger';
import { mkdir } from '../mkdir';
import HTMLPlugin from '../plugins/html';
import { generateRandom } from '../random';
import { rmdir } from '../rmdir';
import { ConfigureRoutes } from '../router/configure';
import { getConfig } from '../config';
import Params from '../plugins/params';

type Files = ReturnType<typeof ConfigureRoutes>[0];

const pages = new Map();

const worker: Array<{ name: string; script: string }> = [];

function readAppJSON(config: Config): object {
  const path = join(process.cwd(), config.public || 'public', '.astound/client.json');

  if (existsSync(path)) {
    return JSON.parse(readFileSync(path).toString());
  }
  return {};
}

export function generateHTML(html: string, scripts: Array<{ name: string; script: string }>) {
  return [
    `var __render = function () {
      const html = \`${html.replace(/`/g, '\\`')}\`;
      var app; if(document.getElementById("_app")) {
        app = document.getElementById("_app");document.getElementById("_app").innerHTML = ""; 
      } else {
        app = document.createElement("div");
      }
      app.innerHTML = html; app.setAttribute("id", "_app");
      document.body.prepend(app);;addlistener();
      /*rendering scripts*/
      Array.from(document.body.querySelectorAll('script')).forEach((old) => {
        if (old.getAttribute("src")?.trim().startsWith('/.astound')) return;
        const news = document.createElement('script');
        Array.from(old.attributes).forEach((attr) => news.setAttribute(attr.name, attr.value));
        news.appendChild(document.createTextNode(old.innerHTML));
        old.parentNode.replaceChild(news, old);
      });
    };
    __render();addlistener();
    if (!window.astound) {
      window.astound = {};
    }
    if (!window.astound.load) window.astound.load = {};
    window.astound.load[window.location.pathname] = __render;
    `,
    `function addlistener() {
      if (window.astound?.__addListener) {
        astound.__addListener();
      }

    }`,
    '/*renderer*/',
    `window.addEventListener("load", () => {${scripts
      .map(
        (script) =>
          `var e=document.createElement("script");e.setAttribute("pagemodule" , "");e.setAttribute("src", "${script.script}");e.setAttribute("type", "module");document.body.appendChild(e);`
      )
      .join('/**/')}});`,
  ].join('/*    */');
}

/**
 * build specific page
 * @param file file path (generated by ConfigureRoutes())
 * @param config Config
 */
export function builder(file: Files, config: Config) {
  if (!config.plugins) config.plugins = [];
  config.plugins.push(HTMLPlugin());
  config.plugins.push(Client());
  config.plugins.push(Params());

  const ROOT = join(process.cwd(), config.public || 'public', '.astound');
  const OUTPUTDIR = join(ROOT, 'js');
  const APP = join(process.cwd(), config.app || 'app');

  // if already existed
  if (['ts', 'js'].includes(file.ext)) {
    pages.set(
      file.file,
      generateModule(join(process.cwd(), config.app || 'app', file.file), { cfg: config, alias: file.file })
    );
  } else {
    let hash = generateRandom(2);

    if (Object.hasOwn(readAppJSON(config), file.file)) {
      hash = readAppJSON(config)[file.file];
    }

    const $ = {
      js: '',
      html: '',
    };
    const code = readFileSync(join(APP, file.file)).toString();

    pages.set(file.file, hash);

    config.plugins?.forEach(async (plugin) => {
      if (typeof plugin === 'string') {
        try {
          plugin = require(plugin) as Plugin;
        } catch (e) {
          error(e);
        }
      }

      if (!(plugin as Plugin).transform) return;

      if ((plugin as Plugin).transform.constructor.name === 'AsyncFunction') {
        const output = await (plugin as Plugin).transform(file.file, code, $);
        if (output) {
          if (output.type === 'html') {
            $.html = output.code;
          } else if (output.type === 'js') {
            $.js = output.code;
          }
        }
      } else {
        const output = (plugin as Plugin).transform(file.file, code, $) as TransformOutput;
        if (output) {
          if (output.type === 'html') {
            $.html = output.code;
          } else if (output.type === 'js') {
            $.js = output.code;
          }
        }
      }
    });

    writeFileSync(join(OUTPUTDIR, `${hash}.js`), $.js);
    writeFileSync(join(OUTPUTDIR, `${hash}.client.js`), generateHTML($.html, [...worker]));
  }
  writeFileSync(join(ROOT, 'client.json'), JSON.stringify(Object.fromEntries(pages)));
}

/**
 * update page
 * @param file
 * @param config
 */
export function updatePage(file: Files, config: Config) {
  const page = readAppJSON(getConfig());
  if (Object.hasOwn(page, file.file)) {
    builder(file, config);
  } else {
    error(`Something going wrong. Please restart program :(\n${JSON.stringify(page)}\n${JSON.stringify(file)}`);
  }
}

/**
 * create new page
 * @param file
 * @param config
 */
export function newPage(file: Files, config: Config) {
  builder(file, config);
}

/**
 * remove page
 * @param file
 * @param config
 */
export function removePage(file: Files, config: Config) {
  const path = join(process.cwd(), config.public || 'public', '.astound', 'client.json');
  const json = readAppJSON(config);
  if (Object.hasOwn(json, file.file)) {
    delete json[file.file];
    writeFileSync(path, JSON.stringify(json));
  } else {
    error('Something going wrong. Please restart program :(');
  }
}

/**
 * build application
 * @param config app config
 */
export function build(config: Config = {}) {
  pages.clear();

  const ROOT = join(process.cwd(), config.public || 'public', '.astound');
  const OUTPUTDIR = join(ROOT, 'js');

  // init project

  rmdir(ROOT);

  mkdir(ROOT);
  mkdir(OUTPUTDIR);
  if (!config.plugins) config.plugins = [];
  config.plugins.push(HTMLPlugin());
  config.plugins.push(Client());
  config.plugins.push(Params());

  config.plugins?.forEach((plugin) => {
    if (typeof plugin === 'string') {
      try {
        plugin = require(plugin) as Plugin;
      } catch (e) {
        error(e);
      }
    }
    const plug = plugin as Plugin;

    if (plug.addScript) {
      const hash = generateRandom();
      writeFileSync(join(OUTPUTDIR, `w.${hash}.js`), plug.addScript());
      worker.push({ name: plug.name, script: `/.astound/js/w.${hash}.js` });
    }
  });

  ConfigureRoutes(config).forEach((file) => {
    builder(file, config);
  });
}
