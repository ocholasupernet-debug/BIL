const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'OcholaSuperNet';
const BASE_PATH = '/mobile';
const STATIC_ROOT = path.resolve(__dirname, '..', 'dist', 'desktop');
const ICON_PATH = path.resolve(
  __dirname,
  '..',
  'assets',
  'images',
  'ocholasupernet-app-icon.png',
);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let staticServer;

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Cache-Control': status === 200 ? 'no-cache' : 'no-store',
    'Content-Type': contentType,
  });
  res.end(body);
}

function staticFilePath(relativePath) {
  const normalized = path.posix.normalize(`/${relativePath}`).replace(/^\/+/, '');
  const filePath = path.resolve(STATIC_ROOT, normalized);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === BASE_PATH) pathname = `${BASE_PATH}/`;
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }

  const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = staticFilePath(requestedFile);
  const exists = filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Expo Router handles client-side routes. Serve the document for those
  // routes, but never use the fallback for a missing asset-like request.
  const isAssetRequest = path.extname(requestedFile) !== '';
  const fallbackPath = staticFilePath('index.html');
  const resolvedPath = exists ? filePath : !isAssetRequest ? fallbackPath : null;

  if (!resolvedPath) {
    send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  send(
    res,
    200,
    MIME_TYPES[extension] || 'application/octet-stream',
    fs.readFileSync(resolvedPath),
  );
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer(serveStatic);
    staticServer.once('error', reject);
    staticServer.listen(0, '127.0.0.1', () => {
      const address = staticServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine the desktop server address.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function stopStaticServer() {
  if (!staticServer) return;
  staticServer.close();
  staticServer = undefined;
}

async function createWindow() {
  if (!fs.existsSync(path.join(STATIC_ROOT, 'index.html'))) {
    throw new Error(
      `Desktop export is missing at ${STATIC_ROOT}. Run "pnpm run build:desktop" first.`,
    );
  }

  const serverOrigin = await startStaticServer();
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#081416',
    icon: ICON_PATH,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.on('closed', stopStaticServer);
  await window.loadURL(`${serverOrigin}${BASE_PATH}/`);
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('org.isplatty.ocholasupernet.desktop');

app.whenReady().then(() => createWindow()).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('before-quit', stopStaticServer);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});