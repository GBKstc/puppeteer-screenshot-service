import https from 'https';
import http from 'http';
import crypto from 'crypto';
import FormData from 'form-data';
import sharp from 'sharp';

// 获取 Policy
export const getPolicy = () => {
  const date = new Date();
  date.setHours(date.getHours() + 1);

  const policy = {
    expiration: date.toISOString(),
    conditions: [
      ["content-length-range", 0, 50 * 1024 * 1024]
    ]
  };

  const policyString = JSON.stringify(policy);
  const base64Policy = Buffer.from(policyString).toString('base64');

  return base64Policy;
};

// 计算签名
export const computeSignature = (accessKeySecret, canonicalString) => {
  const hmac = crypto.createHmac('sha1', accessKeySecret);
  hmac.update(canonicalString);
  const signature = hmac.digest('base64');

  return signature;
};

// 获取 STS Token
const url = 'https://platformpro.aiwobeauty.com/api/aiwo-plat-oss/sts/getStsToken';
const postData = JSON.stringify({
  // 如果需要传递请求体，请在这里添加
  // data: 'value'
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
    // 如果需要添加更多请求头，请在这里添加
  }
};

export const getStsToken = async () => {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve(parsedData);
        } catch (error) {
          reject(`Error parsing JSON: ${error.message}`);
        }
      });
    });

    req.on('error', (error) => {
      reject(`Error fetching STS Token: ${error.message}`);
    });

    req.write(postData);
    req.end();
  });
};

// 获取上传参数
export const getFormDataParams = async (fileName) => {
  const res = await getStsToken();
  console.log('res', res);
  const info = res.data;
  const policy = getPolicy();
  const signature = computeSignature(info.accessKeySecret, policy);
  const formData = {
    key: 'aiwo-platform/compass-source/wxGptImage/' + fileName,
    policy,
    OSSAccessKeyId: info.accessKeyId,
    signature,
    'x-oss-security-token': info.securityToken
  };
  return formData;
};

// 上传文件到 OSS
export const uploadFile = async (compressedBuffer, filename) => {
  const formDataParams = await getFormDataParams(filename);
  console.log('formDataParams', formDataParams);
  console.log('compressedBuffer', compressedBuffer);

  return new Promise((resolve, reject) => {
    const form = new FormData();

    for (const key in formDataParams) {
      form.append(key, formDataParams[key]);
    }

    form.append('file', compressedBuffer, { filename: filename, contentType: 'image/jpeg' });
    console.log('正在上传文件...');
    const req = http.request({
      hostname: 'aiwo-platform.oss-cn-hangzhou.aliyuncs.com',
      path: '/',
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 204) {
          console.log('文件上传成功');
          resolve(formDataParams);
        } else {
          console.error('上传失败，状态码:', res.statusCode);
          reject(new Error('上传失败'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('上传失败，错误信息:', error);
      reject(error);
    });

    form.pipe(req);
    req.end();
  });
};

// 示例用法
// const screenshotBuffer = Buffer.from('...'); // 这里替换为实际的 buffer
// const filename = 'screenshot.jpg';

// sharp(screenshotBuffer)
//   .jpeg({ quality: 80 })
//   .toBuffer()
//   .then(compressedBuffer => {
//     uploadFile(compressedBuffer, filename)
//       .then(result => {
//         console.log('上传完成', result);
//       })
//       .catch(err => {
//         console.error('上传失败:', err);
//       });
//   })
//   .catch(err => {
//     console.error('压缩图片失败:', err);
//   });
