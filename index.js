import express from 'express';
import puppeteer from 'puppeteer';
import { default as PQueue } from 'p-queue';
import { uploadFile } from './oss/index.js';
import crypto from 'crypto';
import sharp from 'sharp';

const app = express();
const port = 3000;

// Create a queue with concurrency of 1 (i.e., one screenshot at a time)
const queue = new PQueue({ concurrency: 5 });

// Function to generate a random string
function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex');
}

// Function to scroll the page to load lazy-loaded content
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// Function to pause execution for a given amount of time
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let browser;
(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
})();

app.get('/screenshot', async (req, res) => {

  const encodedUrl = req.query.url;
  const url = decodeURIComponent(encodedUrl); // 解码 URL

  const type = req.query.type;
  const width = parseInt(req.query.width, 10) || null;
  const height = parseInt(req.query.height, 10) || null;
  const fullPage = req.query.fullPage === 'true';
  const quality = parseInt(req.query.quality, 10) || 80; // Default quality to 80 if not provided
  const resType = req.query.resType || 'buffer'; //oss 或者 buffer 默认是buffer
  const eleId = req.query.eleId || null;  //如果是有值的 就是元素截图

  if (!url) {
    return res.status(400).send('URL parameter is missing');
  }

  // Add the screenshot task to the queue
  queue.add(async () => {
    try {
      // const browser = await puppeteer.launch({
      //   args: ['--no-sandbox', '--disable-setuid-sandbox']
      // });
      const page = await browser.newPage();

      if (type === 'mobile') {
        // Set the viewport to the iPhone 15 dimensions or custom dimensions
        await page.setViewport({
          width: width || 585,
          height: height || 1266,
          deviceScaleFactor: 3,  // iPhone 15's Retina display
        });
        // Set the user agent to a mobile user agent
        await page.setUserAgent(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
        );
      } else {
        // Set the viewport to the default or custom dimensions
        await page.setViewport({
          width: width || 1920,
          height: height || 1080,
          deviceScaleFactor: 2,  // Default Retina display
        });
      }

      // Increase the navigation timeout or disable it
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Check if fullPage is true, if not, wait for the lazy-loaded content
      if (!fullPage) {
        // Wait for a few seconds to ensure lazy-loaded content is loaded
        await sleep(3000);
      } else {
        // Scroll to load lazy-loaded content if fullPage is true
        await autoScroll(page);
      }
      let screenshotBuffer = null;

      if (eleId) {
        // 等待目标元素加载并选择它
        const element = await page.$('#' + eleId); // 替换 'selector' 为你的目标元素选择器
        // 确保元素存在
        if (!element) {
          await browser.close();
          console.log('找不到 id 为 ' + eleId + ' 的元素');
          return new Error('找不到 id 为 ' + eleId + ' 的元素');
        }
        screenshotBuffer = await element.screenshot({});
      } else {
        screenshotBuffer = await page.screenshot({ fullPage });
      }
      await browser.close();
      // Compress the screenshot using sharp
      const compressedBuffer = await sharp(screenshotBuffer)
        .jpeg({ quality: quality })
        .toBuffer();

      const base64String = compressedBuffer.toString('base64');
      // Generate a random file name
      const randomFileName = `screenshot_${generateRandomString(8)}.jpg`;

      if (resType === 'buffer') {
        // res.setHeader('Content-Disposition', 'attachment; filename=' + randomFileName);
        // res.setHeader('Content-Type', 'image/jpeg');
        // res.send(compressedBuffer);
        // 将 Buffer 转换为 Base64 字符串
        const base64String = compressedBuffer.toString('base64');
        // 生成 Data URL
        const mimeType = 'image/jpeg'; // 根据实际格式设置 MIME 类型
        const dataUrl = `data:${mimeType};base64,${base64String}`;
        // 返回 Base64 数据作为 JSON 响应
        res.json({ image: dataUrl });
        return;
      }
      if (resType === 'oss') {
        const upFileRes = await uploadFile(compressedBuffer, randomFileName);
        res.json({
          success: true,
          message: '执行成功',
          reason: null,
          code: '200',
          data: {
            filePath: `https://static.aiwobeauty.com/${upFileRes.key}`
          }
        });
        return;
      }
    } catch (error) {
      console.error(`Failed to capture screenshot: ${error.message}`);
      res.status(500).json({
        success: false,
        message: '上传失败',
        reason: error.message,
        code: '500',
        data: null
      });
    }
  }).catch(error => {
    console.error(`Queue error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: '系统错误',
      reason: error.message,
      code: '500',
      data: null
    });
  });
});

app.listen(port, () => {
  console.log(`Screenshot service listening at http://localhost:${port}`);
});
