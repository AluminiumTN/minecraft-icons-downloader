import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_URL = 'https://minecraft.wiki/w/Block';
const HTML_FILE = path.join(__dirname, 'blocks.html');
const OUTPUT_DIR = path.join(__dirname, 'minecraft_blocks');

puppeteer.use(StealthPlugin());

function normalizeFilename(original) {
  return original
    .toLowerCase()
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%26/g, '&')
    .replace(/ *\([^)]*\) */g, '')
    .replace(/(\d+px-)/g, '')
    .replace(/(_je\d+)?(_be\d+)?/gi, '')
    .replace(/[?&].*$/, '')
    .replace(/_+/g, ' ')
    .replace(/blocksprite_/g, '') // if need you can delete this and download blocksprites also
    .replace(/_sprite/g, '') 
    .trim()
    .replace(/ /g, '_')
    .replace(/(.+?)(\.[^.]*)?$/, '$1.png');
}

async function downloadHtml() {
  if (fs.existsSync(HTML_FILE)) {
    console.log('HTML файл уже существует');
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' }); //need to get link of all blocks
  const page = await browser.newPage();
  
  try {
    console.log('Скачиваем HTML...');
    await page.goto(TARGET_URL, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });
    
    await page.evaluate(async () => {
      window.scrollBy(0, window.innerHeight);
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    const html = await page.content();
    fs.writeFileSync(HTML_FILE, html);
    console.log(`HTML сохранен: ${HTML_FILE}`);
    
  } finally {
    await browser.close();
  }
}

async function downloadImages() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  
  const html = fs.readFileSync(HTML_FILE, 'utf-8');
  const $ = cheerio.load(html);

  const imageLinks = $('a.image img, img.mw-file-element')
    .map((i, el) => {
      const $el = $(el);
      if (
        $el.closest('.sprite').length > 0 || 
        $el.parents('.sprite-list').length > 0 ||
        $el.attr('alt')?.toLowerCase().includes('sprite')
      ) return null;

      const src = $el.attr('src') || '';
      return src.includes('/thumb/') 
        ? src.replace('/thumb/', '/').split('/').slice(0, -1).join('/')
        : src;
    })
    .get()
    .filter(src => {
      const cleanSrc = src.toLowerCase();
      return (
        src.startsWith('/images/') &&
        !cleanSrc.includes('/block/') &&
        !cleanSrc.includes('sprite') &&
        !cleanSrc.match(/(blocksprite|_sprite)/)
      );
    });

  console.log(`Найдено изображений после фильтрации: ${imageLinks.length}`);

  for (const relativePath of imageLinks) {
    try {
      const cleanUrl = relativePath
        .replace(/\/(?:thumb|metadata)\//g, '/')
        .split('?')[0];

      const filename = normalizeFilename(path.basename(cleanUrl));
      
      if (filename.includes('blocksprite') || filename.includes('_sprite')) {
        console.log(`Пропускаем блокспрайт: ${filename}`);
        continue;
      }

      const imageUrl = `https://minecraft.wiki${cleanUrl}`;
      const outputPath = path.join(OUTPUT_DIR, filename);

      if (fs.existsSync(outputPath)) {
        console.log(`Пропускаем: ${filename}`);
        continue;
      }

      console.log(`Скачиваем: ${filename}`);
      const response = await fetch(imageUrl);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const buffer = await response.buffer();
      fs.writeFileSync(outputPath, buffer);
      console.log(`Сохранено: ${filename}`);

    } catch (error) {
      console.error(`Ошибка: ${relativePath} - ${error.message}`);
    }
  }
}

async function main() {
  try {
    await downloadHtml();
    await downloadImages();
    console.log('Готово!');
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

main();