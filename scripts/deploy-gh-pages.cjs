'use strict';

// 把 dist/ 目录的内容作为 gh-pages 分支推送到 origin。
// 零依赖，仅使用 Node.js 内置模块 + git CLI。
//
// 流程：
//   1. 校验 dist/ 已构建完成
//   2. 在系统临时目录下创建一个干净的工作区
//   3. 把 dist/ 内容复制过去
//   4. 在工作区里 git init + commit + force push 到 origin 的 gh-pages 分支
//   5. 清理临时工作区
//
// 用法：
//   node scripts/deploy-gh-pages.cjs
//
// 可选环境变量：
//   DASHBOARD_REMOTE  默认 origin，可改成完整 URL 用于其他远程
//   DASHBOARD_BRANCH  默认 gh-pages
//   GIT_AUTHOR_NAME   commit 作者名，默认 "Kindle Dashboard Bot"
//   GIT_AUTHOR_EMAIL  commit 邮箱，默认 "bot@kindle-dashboard.local"

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../src/lib/config.cjs');

const DIST_DIR = path.join(ROOT, 'dist');
const REMOTE = process.env.DASHBOARD_REMOTE || 'origin';
const BRANCH = process.env.DASHBOARD_BRANCH || 'gh-pages';
const AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'Kindle Dashboard Bot';
const AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 'bot@kindle-dashboard.local';

const REQUIRED_FILES = ['index.html', 'dashboard-runtime.js', 'data.js', 'data.json', '.nojekyll'];

function fail(message) {
  process.stderr.write(`[deploy-gh-pages] ${message}\n`);
  process.exitCode = 1;
}

function git(args, cwd, opts = {}) {
  const stdio = opts.silent ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'pipe', 'pipe'];
  try {
    return execFileSync('git', args, {
      cwd,
      stdio,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: AUTHOR_NAME,
        GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: AUTHOR_NAME,
        GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      },
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    const stdout = error.stdout ? error.stdout.toString().trim() : '';
    throw new Error(
      `git ${args.join(' ')} 失败` +
      (stderr ? `\n  stderr: ${stderr}` : '') +
      (stdout ? `\n  stdout: ${stdout}` : '') +
      (error.message ? `\n  error: ${error.message}` : '')
    );
  }
}

function copyRecursive(source, target) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
  } else {
    fs.copyFileSync(source, target);
  }
}

function rmRecursive(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function resolveRemoteUrl() {
  if (/^https?:\/\//.test(REMOTE) || /^git@/.test(REMOTE)) {
    return REMOTE;
  }
  try {
    return git(['remote', 'get-url', REMOTE], ROOT, { silent: true });
  } catch {
    throw new Error(`无法解析远程 ${REMOTE} 的 URL`);
  }
}

function main() {
  for (const name of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(DIST_DIR, name))) {
      throw new Error(`dist/${name} 不存在，请先运行 npm run build`);
    }
  }

  const remoteUrl = resolveRemoteUrl();
  if (!remoteUrl) throw new Error('未获取到 remote URL');
  process.stdout.write(`[deploy-gh-pages] remote=${remoteUrl} branch=${BRANCH}\n`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-gh-pages-'));
  const workDir = path.join(tmpRoot, 'repo');
  try {
    fs.mkdirSync(workDir, { recursive: true });
    copyRecursive(DIST_DIR, workDir);

    // 必须的占位文件，确保 gh-pages 分支不为空
    fs.writeFileSync(path.join(workDir, '.nojekyll'), '', 'utf8');

    git(['init', '--initial-branch', BRANCH], workDir, { silent: true });
    git(['add', '-A'], workDir, { silent: true });

    const hasStaged = git(['status', '--porcelain'], workDir, { silent: true });
    if (!hasStaged) {
      process.stdout.write('[deploy-gh-pages] 没有变化，跳过推送\n');
      return;
    }

    const timestamp = new Date().toISOString();
    git(['commit', '-m', `deploy dashboard ${timestamp}`], workDir, { silent: true });

    git(['remote', 'add', 'origin', remoteUrl], workDir, { silent: true });
    // 强制推送：每次部署都是全新的孤儿提交，覆盖远程 gh-pages
    git(['push', '--force', 'origin', `HEAD:${BRANCH}`], workDir);

    process.stdout.write(`[deploy-gh-pages] 已推送到 ${remoteUrl} 的 ${BRANCH} 分支\n`);
  } finally {
    rmRecursive(tmpRoot);
  }
}

try {
  main();
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
