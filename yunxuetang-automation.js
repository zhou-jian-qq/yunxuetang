// ==UserScript==
// @name         云学堂自动化脚本
// @namespace    https://yunxuetang.cn/
// @version      1.4.24
// @description  云学堂自动化脚本，支持自动登录、首页自动操作、列表查找和学习详情页自动学习，并可适配不同云学堂组织站点。
// @author       Codex
// @match        https://*.yunxuetang.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORE_KEY = 'yunxuetang_automation_settings';
    const LAST_LIST_URL_KEY = 'yunxuetang_automation_last_list_url';
    const SKIP_COMPLETED_KEY = 'yunxuetang_automation_skip_completed';
    const LIST_REFRESH_PENDING_KEY = 'yunxuetang_automation_list_refresh_pending';
    const SKIP_COMPLETED_TTL_MS = 60 * 60 * 1000;
    const DEFAULT_SETTINGS = {
        enabled: false,
        username: '',
        password: '',
        loginStepDelayMs: 1,
        homeAutoViewAllEnabled: true,
        homeViewAllDelayMs: 5,
        listAutoOpenEnabled: true,
        listActionDelayMs: 2,
        detailAutoStudyEnabled: true,
        detailInitialDelayMs: 30,
        detailCheckIntervalMs: 30
    };

    // 课程评论弹窗随机见解文案，提交前随机选一条。
    const COURSE_REVIEW_COMMENTS = [
        '课程很及时',
        '课程很好',
        '很有用',
        '内容很实用',
        '讲得很清楚',
        '收获很大',
        '学到了很多',
        '案例很贴近实际',
        '值得学习',
        '受益匪浅',
        '知识点讲解到位',
        '对我工作很有帮助',
        '条理清晰，容易理解',
        '内容充实，干货不少',
        '结合业务场景很到位',
        '学习体验不错',
        '讲解细致，印象深刻',
        '实用性强，能马上用',
        '覆盖面广，很有启发',
        '节奏合适，听着不累',
        '重点突出，便于掌握',
        '质量很高，推荐学习',
        '解决了不少实际问题',
        '内容更新及时，很受用',
        '老师讲得好，容易吸收',
        '结构完整，收获满满',
        '表达简洁，重点明确',
        '贴近日常工作，很实用',
        '例子生动，更好理解',
        '学完感觉很有收获',
        '内容扎实，值得反复看',
        '讲解透彻，帮助很大'
    ];

    const state = {
        loginTried: false,
        loginFlowStarted: false,
        homeViewAllScheduled: false,
        homeViewAllClicked: false,
        listActionScheduled: false,
        listItemClicked: false,
        listPageTurning: false,
        detailInitialTimer: 0,
        detailCheckTimer: 0,
        scanTransitionTimer: 0,
        detailStarted: false,
        detailBackClicked: false,
        courseReviewSubmitting: false,
        panelOpen: false,
        lastRouteKey: ''
    };

    // 统一输出控制台日志，每条日志带上时间前缀。
    function logStep(message, detail) {
        const now = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const prefix = `[${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}]`;
        if (typeof detail === 'undefined') {
            console.log(`${prefix} ${message}`);
            return;
        }
        console.log(`${prefix} ${message}`, detail);
    }

    // 生成可安全打印的配置摘要，避免把密码明文输出到控制台。
    function safeSettingsInfo(settings) {
        return {
            enabled: Boolean(settings.enabled),
            username: settings.username || '',
            passwordConfigured: Boolean(settings.password),
            passwordLength: settings.password ? settings.password.length : 0,
            loginStepDelayMs: normalizeDelayMs(settings.loginStepDelayMs, DEFAULT_SETTINGS.loginStepDelayMs),
            homeAutoViewAllEnabled: Boolean(settings.homeAutoViewAllEnabled),
            homeViewAllDelayMs: normalizeDelayMs(settings.homeViewAllDelayMs, DEFAULT_SETTINGS.homeViewAllDelayMs),
            listAutoOpenEnabled: Boolean(settings.listAutoOpenEnabled),
            listActionDelayMs: normalizeDelayMs(settings.listActionDelayMs, DEFAULT_SETTINGS.listActionDelayMs),
            detailAutoStudyEnabled: Boolean(settings.detailAutoStudyEnabled),
            detailInitialDelayMs: normalizeDelayMs(settings.detailInitialDelayMs, DEFAULT_SETTINGS.detailInitialDelayMs),
            detailCheckIntervalMs: normalizeDelayMs(settings.detailCheckIntervalMs, DEFAULT_SETTINGS.detailCheckIntervalMs)
        };
    }

    // 规范化秒级配置值，限制在 0 到 600 秒之间。
    function normalizeDelayMs(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(Math.max(Math.round(number), 0), 600);
    }

    // 将输入框或 localStorage 中的秒数转成整数秒。
    function normalizeSeconds(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(Math.max(Math.round(number), 0), 600);
    }

    // 将秒转换成 setTimeout 使用的毫秒。
    function secondsToMs(seconds) {
        return normalizeSeconds(seconds, 0) * 1000;
    }

    // 按指定秒数等待，并在控制台打印当前等待步骤。
    function waitSeconds(seconds, label) {
        const safeSeconds = normalizeSeconds(seconds, 0);
        logStep(`等待 ${safeSeconds} 秒：${label}`);
        return new Promise((resolve) => window.setTimeout(resolve, secondsToMs(safeSeconds)));
    }

    // 从当前网站 localStorage 读取脚本配置。
    function loadSettings() {
        try {
            logStep('读取 localStorage 配置开始。', { key: STORE_KEY });
            const saved = window.localStorage.getItem(STORE_KEY);
            if (!saved) {
                logStep('localStorage 中没有配置，使用默认配置。');
                return { ...DEFAULT_SETTINGS };
            }
            const parsed = JSON.parse(saved);
            const settings = { ...DEFAULT_SETTINGS, ...parsed };
            logStep('读取 localStorage 配置完成。', safeSettingsInfo(settings));
            return settings;
        } catch (error) {
            console.warn('[云学堂自动化脚本] 读取配置失败，将使用默认配置。', error);
            return { ...DEFAULT_SETTINGS };
        }
    }

    // 将脚本配置明文保存到当前网站 localStorage。
    function saveSettings(settings) {
        const next = {
            ...DEFAULT_SETTINGS,
            ...settings,
            loginStepDelayMs: normalizeSeconds(settings.loginStepDelayMs, DEFAULT_SETTINGS.loginStepDelayMs),
            homeViewAllDelayMs: normalizeSeconds(settings.homeViewAllDelayMs, DEFAULT_SETTINGS.homeViewAllDelayMs),
            listActionDelayMs: normalizeSeconds(settings.listActionDelayMs, DEFAULT_SETTINGS.listActionDelayMs),
            detailInitialDelayMs: normalizeSeconds(settings.detailInitialDelayMs, DEFAULT_SETTINGS.detailInitialDelayMs),
            detailCheckIntervalMs: normalizeSeconds(settings.detailCheckIntervalMs, DEFAULT_SETTINGS.detailCheckIntervalMs)
        };
        logStep('写入 localStorage 配置。', { key: STORE_KEY, ...safeSettingsInfo(next) });
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
        logStep('localStorage 配置保存完成。');
    }

    // 判断元素是否在页面中可见，用于过滤隐藏表单和隐藏按钮。
    function isVisible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    // 按选择器顺序查找第一个可见元素。
    function queryVisible(selectors) {
        for (const selector of selectors) {
            const found = Array.from(document.querySelectorAll(selector)).find(isVisible);
            if (found) return found;
        }
        return null;
    }

    // 读取元素可见文本，优先使用 innerText，避免空 wrapper 影响弹窗排查。
    function getVisibleText(element) {
        if (!element) return '';
        return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // 读取用于匹配的紧凑文本。
    function getCompactText(element) {
        return getVisibleText(element).replace(/\s+/g, '');
    }

    // 使用原生 setter 设置输入框值，确保 Vue/React 等框架能监听到变化。
    function setNativeValue(input, value) {
        logStep('设置输入框内容。', {
            type: input.type,
            name: input.name || '',
            placeholder: input.getAttribute('placeholder') || '',
            valueLength: value ? value.length : 0
        });
        const proto = input instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    // 使用原生 setter 设置复选框状态，确保页面框架能收到 change 事件。
    function setNativeChecked(input, checked) {
        logStep('设置复选框状态。', { checked });
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
        if (descriptor && descriptor.set) {
            descriptor.set.call(input, checked);
        } else {
            input.checked = checked;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 模拟完整鼠标点击流程，提升对组件库按钮和 label 的兼容性。
    function clickElement(element) {
        logStep('点击页面元素。', {
            tag: element.tagName,
            className: String(element.className || ''),
            text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        });
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        element.click();
    }

    // 在当前标签页打开地址，避免站点按钮通过 target 或 window.open 新开窗口。
    function openInCurrentPage(url, source) {
        if (!url) return false;
        const targetUrl = new URL(url, location.href).href;
        logStep('准备在当前页打开地址。', { source, targetUrl });
        location.href = targetUrl;
        return true;
    }

    // 点击元素前临时移除链接 target，点击后短时间劫持 window.open，强制当前页打开。
    function clickElementInCurrentPage(element) {
        const ancestors = [];
        let cursor = element;
        while (cursor && cursor !== document.documentElement) {
            ancestors.push(cursor);
            cursor = cursor.parentElement;
        }
        const clickableChain = [...ancestors, ...Array.from(element.querySelectorAll ? element.querySelectorAll('*') : [])];
        const targetElements = clickableChain.filter((node) => node && node.getAttribute && node.hasAttribute('target'));
        const oldTargets = targetElements.map((node) => ({ node, target: node.getAttribute('target') }));
        targetElements.forEach(({ node }) => node.removeAttribute('target'));

        const directLink = element.closest && element.closest('a[href]');
        const originalOpen = window.open;
        let openedByScript = false;
        window.open = function patchedWindowOpen(url) {
            openedByScript = true;
            logStep('拦截到 window.open，改为当前页打开。', { url });
            if (url) openInCurrentPage(url, 'window.open 拦截');
            return null;
        };

        try {
            logStep('准备以当前页方式点击元素。', {
                href: directLink ? directLink.href : '',
                removedTargetCount: targetElements.length
            });
            clickElement(element);
            if (!openedByScript && directLink && directLink.href && isLearningListUrl(directLink.href)) {
                openInCurrentPage(directLink.href, '链接兜底');
            }
        } finally {
            window.setTimeout(() => {
                window.open = originalOpen;
                oldTargets.forEach(({ node, target }) => node.setAttribute('target', target));
                logStep('恢复 window.open 和链接 target。');
            }, 1000);
        }
    }

    // 查找登录页“已阅读并同意隐私政策”的复选框。
    function findAgreementCheckbox() {
        logStep('查找隐私政策同意复选框。');
        const visibleProtocols = Array.from(document.querySelectorAll('.secret-protocol')).filter((protocol) => {
            const text = (protocol.innerText || protocol.textContent || '').replace(/\s+/g, '');
            return isVisible(protocol) && text.includes('已阅读并同意');
        });
        const checkbox = visibleProtocols
            .map((protocol) => protocol.querySelector('input[type="checkbox"]'))
            .find(Boolean) || null;
        logStep(checkbox ? '已找到隐私政策同意复选框。' : '未找到隐私政策同意复选框。');
        return checkbox;
    }

    // 查找登录页用户名、密码、隐私政策复选框和登录按钮。
    function findLoginForm() {
        logStep('查找登录表单元素。');
        const usernameInput = queryVisible([
            'input[name="username"][type="text"]',
            'input[placeholder*="员工邮箱"]',
            'input[placeholder*="账号"]',
            'input[placeholder*="邮箱"]'
        ]);
        const passwordInput = queryVisible([
            'input[type="password"][name="username"]',
            'input[type="password"]',
            'input[placeholder*="密码"]'
        ]);
        if (!usernameInput || !passwordInput) return null;

        const checkbox = findAgreementCheckbox();
        const loginButton = Array.from(document.querySelectorAll('button')).find((button) => {
            const text = (button.innerText || button.textContent || '').replace(/\s+/g, '');
            return isVisible(button) && text.includes('登录');
        });

        logStep('登录表单查找结果。', {
            usernameInput: Boolean(usernameInput),
            passwordInput: Boolean(passwordInput),
            agreementCheckbox: Boolean(checkbox),
            loginButton: Boolean(loginButton),
            loginButtonDisabled: loginButton ? loginButton.disabled || String(loginButton.className).includes('is-disabled') : null
        });
        return { usernameInput, passwordInput, checkbox, loginButton };
    }

    // 判断当前是否已经不需要登录，主要用于避免重复提交登录。
    function hasLoggedInSignal() {
        logStep('检查当前是否已登录。', { path: location.pathname, href: location.href });
        const loginForm = findLoginForm();
        if (loginForm) {
            logStep('检测到登录表单，当前视为未登录。');
            return false;
        }
        const loggedIn = !location.pathname.includes('login');
        logStep(loggedIn ? '未检测到登录表单，当前视为已登录。' : '当前仍在登录页，且未检测到可用登录表单。');
        return loggedIn;
    }

    // 按配置执行自动登录流程：等待、填用户名、填密码、勾选协议、点击登录。
    function fillAndLogin(settings, source) {
        logStep('准备执行自动登录流程。', { source, ...safeSettingsInfo(settings) });
        if (state.loginFlowStarted) {
            logStep('跳过自动登录：登录流程已经开始。');
            return false;
        }
        if (!settings.enabled) {
            logStep('跳过自动登录：未启用自动登录。');
            return false;
        }
        if (!settings.username) {
            logStep('跳过自动登录：未配置用户名。');
            return false;
        }
        if (!settings.password) {
            logStep('跳过自动登录：未配置密码。');
            return false;
        }
        if (hasLoggedInSignal()) {
            logStep('跳过自动登录：当前已经登录或不在登录页。');
            return false;
        }

        const form = findLoginForm();
        if (!form || !form.loginButton) {
            logStep('跳过自动登录：未找到完整登录表单或登录按钮。');
            return false;
        }

        state.loginFlowStarted = true;
        logStep('自动登录流程已启动。');

        (async () => {
            try {
                const stepDelaySeconds = normalizeSeconds(settings.loginStepDelayMs, DEFAULT_SETTINGS.loginStepDelayMs);
                await waitSeconds(stepDelaySeconds, '填写用户名之前');
                let currentForm = findLoginForm();
                if (!currentForm || !currentForm.usernameInput) {
                    logStep('停止自动登录：等待后未找到用户名输入框。');
                    state.loginFlowStarted = false;
                    return;
                }
                logStep('开始填写用户名。');
                setNativeValue(currentForm.usernameInput, settings.username);

                await waitSeconds(stepDelaySeconds, '填写密码之前');
                currentForm = findLoginForm();
                if (!currentForm || !currentForm.passwordInput) {
                    logStep('停止自动登录：等待后未找到密码输入框。');
                    state.loginFlowStarted = false;
                    return;
                }
                logStep('开始填写密码。');
                setNativeValue(currentForm.passwordInput, settings.password);

                await waitSeconds(stepDelaySeconds, '勾选登录协议之前');
                currentForm = findLoginForm();
                if (currentForm && currentForm.checkbox && !currentForm.checkbox.checked) {
                    logStep('隐私政策未勾选，准备勾选。');
                    const checkboxShell = currentForm.checkbox.closest('label') || currentForm.checkbox.closest('.yxt-checkbox__input') || currentForm.checkbox;
                    clickElement(checkboxShell);
                    if (!currentForm.checkbox.checked) setNativeChecked(currentForm.checkbox, true);
                } else if (currentForm && currentForm.checkbox) {
                    logStep('隐私政策已经勾选。');
                } else {
                    logStep('没有找到隐私政策复选框，继续尝试登录。');
                }

                await waitSeconds(stepDelaySeconds, '点击登录按钮之前');
                const stillHere = findLoginForm();
                if (!stillHere || !stillHere.loginButton) {
                    logStep('取消点击登录：延迟检查时未找到登录按钮。');
                    state.loginFlowStarted = false;
                    return;
                }
                if (state.loginTried) {
                    logStep('取消点击登录：本轮已经尝试过登录。');
                    return;
                }
                state.loginTried = true;
                logStep(`${source} 触发自动登录，准备点击登录按钮。`);
                clickElement(stillHere.loginButton);
                logStep('登录按钮点击完成。');
            } catch (error) {
                state.loginFlowStarted = false;
                console.error('[云学堂自动化脚本] 自动登录流程异常。', error);
            }
        })();

        return true;
    }

    // 登录页入口：只在登录页触发自动登录检查。
    function maybeAutoLogin(source) {
        logStep('收到自动登录检查请求。', { source, loginTried: state.loginTried });
        if (!isLoginPage()) {
            logStep('跳过自动登录检查：当前 URL 不是登录页。', { href: location.href });
            return;
        }
        if (state.loginTried || state.loginFlowStarted) {
            logStep('跳过自动登录检查：本轮已经尝试过登录或登录流程正在执行。');
            return;
        }
        fillAndLogin(loadSettings(), source);
    }

    // 获取当前页面 hash 路由，统一处理云学堂 SPA 地址判断。
    function getHashRoute() {
        return location.hash.replace(/^#/, '');
    }

    // 读取 hash 路由中的查询参数，例如 /video/play?...&rate=2。
    function getHashRouteParam(name) {
        const query = getHashRoute().split('?')[1] || '';
        return new URLSearchParams(query).get(name);
    }

    // 判断当前页面路径是否属于指定模块。
    function isModulePath(moduleName) {
        return location.pathname.includes(`/${moduleName}`);
    }

    // 判断当前 URL 是否为登录后的首页。
    function isHomeIndexPage() {
        return isModulePath('main') && getHashRoute().startsWith('/index');
    }

    // 判断当前 URL 是否为登录页。
    function isLoginPage() {
        return location.href.includes('/login.html');
    }

    // 判断当前 URL 是否已经进入在线课堂列表页，cid 等参数不做固定限制。
    function isTargetListPage() {
        return isModulePath('kng') && getHashRoute().startsWith('/list');
    }

    // 判断传入地址是否为在线课堂列表页，cid 等参数不做固定限制，保证不同账号可复用。
    function isLearningListUrl(url) {
        if (typeof url !== 'string') return false;
        try {
            const parsed = new URL(url, location.href);
            return parsed.pathname.includes('/kng') && parsed.hash.replace(/^#/, '').startsWith('/list');
        } catch (error) {
            return url.includes('/kng/#/list');
        }
    }

    // 记录最近一次进入的在线课堂列表页地址，详情页返回兜底时优先使用。
    function rememberCurrentListUrl() {
        if (!isTargetListPage()) return;
        window.localStorage.setItem(LAST_LIST_URL_KEY, location.href);
        logStep('记录当前在线课堂列表页地址。', { href: location.href });
    }

    // 获取详情页返回列表页时使用的兜底地址，避免使用固定测试账号 cid。
    function getFallbackListUrl() {
        const saved = window.localStorage.getItem(LAST_LIST_URL_KEY);
        if (isLearningListUrl(saved)) return saved;
        return `${location.origin}/kng/#/list`;
    }

    // 规范化课程标题，便于详情页与列表卡片比对。
    function normalizeLearningTitle(text) {
        return String(text || '')
            .replace(/\s+/g, '')
            .replace(/已学完|未学完|课程|视频|文档|必学|选修|\d+%|\d+人学习/g, '')
            .slice(0, 100);
    }

    // 从当前详情页 URL 和标题提取课程身份。
    function getCurrentLearningIdentity() {
        const id = getHashRouteParam('kngId') || getHashRouteParam('id') || getHashRouteParam('kid') || '';
        const rawTitle = (document.title || '').split(/[-_|｜]/)[0] || document.title || '';
        const titleNode = queryVisible([
            '.yxtulcdsdk-play-title',
            '[class*="play-title"]',
            '.yxtulcdsdk-course-summary__title',
            'h1',
            'h2'
        ]);
        const pageTitle = titleNode ? getVisibleText(titleNode) : rawTitle;
        return {
            id: String(id || '').trim(),
            title: normalizeLearningTitle(pageTitle || rawTitle)
        };
    }

    // 从列表卡片提取课程身份，优先读取链接中的 kngId。
    function getLearningCardIdentity(card) {
        if (!card) return { id: '', title: '' };
        let id = '';
        const attrNodes = Array.from(card.querySelectorAll('a[href], [data-kng-id], [data-kngid], [data-id], [kng-id]'));
        for (const node of attrNodes) {
            const dataId = node.getAttribute('data-kng-id') || node.getAttribute('data-kngid') || node.getAttribute('kng-id') || '';
            if (dataId) {
                id = dataId;
                break;
            }
            const href = node.getAttribute('href') || '';
            const match = href.match(/[?&#](?:kngId|id|kid)=([^&]+)/i);
            if (match && match[1]) {
                try {
                    id = decodeURIComponent(match[1]);
                } catch (error) {
                    id = match[1];
                }
                break;
            }
        }
        return {
            id: String(id || '').trim(),
            title: normalizeLearningTitle(card.innerText || card.textContent || '')
        };
    }

    // 判断两个课程身份是否指向同一内容。
    function isSameLearningIdentity(left, right) {
        if (!left || !right) return false;
        if (left.id && right.id && left.id === right.id) return true;
        if (left.title && right.title) {
            if (left.title === right.title) return true;
            if (left.title.length >= 6 && right.title.includes(left.title)) return true;
            if (right.title.length >= 6 && left.title.includes(right.title)) return true;
        }
        return false;
    }

    // 读取并清理过期的刚学完跳过名单。
    function loadSkipCompletedItems() {
        try {
            const raw = window.localStorage.getItem(SKIP_COMPLETED_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const now = Date.now();
            const valid = parsed.filter((item) => item && typeof item === 'object' && Number(item.expireAt) > now);
            if (valid.length !== parsed.length) {
                window.localStorage.setItem(SKIP_COMPLETED_KEY, JSON.stringify(valid));
            }
            return valid;
        } catch (error) {
            logStep('读取刚学完跳过名单失败，按空名单处理。', { message: error.message });
            return [];
        }
    }

    // 保存刚学完跳过名单。
    function saveSkipCompletedItems(items) {
        window.localStorage.setItem(SKIP_COMPLETED_KEY, JSON.stringify(items || []));
    }

    // 详情页学完返回前，把当前课程写入跳过名单，避免列表页标签未更新时再次点入。
    function rememberCompletedLearningItem() {
        const identity = getCurrentLearningIdentity();
        if (!identity.id && !identity.title) {
            logStep('无法记录刚学完课程：未提取到有效身份。', { href: location.href });
            return null;
        }
        const now = Date.now();
        const items = loadSkipCompletedItems().filter((item) => !isSameLearningIdentity(item, identity));
        const record = {
            id: identity.id,
            title: identity.title,
            expireAt: now + SKIP_COMPLETED_TTL_MS,
            savedAt: now
        };
        items.unshift(record);
        saveSkipCompletedItems(items.slice(0, 50));
        logStep('已记录刚学完课程到跳过名单。', record);
        return record;
    }

    // 列表卡片是否命中刚学完跳过名单。
    function matchesSkipCompletedLearningCard(card) {
        const identity = getLearningCardIdentity(card);
        return Boolean(loadSkipCompletedItems().find((item) => isSameLearningIdentity(item, identity)));
    }

    // 列表卡片是否命中刚学完跳过名单，命中时输出日志。
    function isSkippedCompletedLearningCard(card) {
        const identity = getLearningCardIdentity(card);
        const matched = loadSkipCompletedItems().find((item) => isSameLearningIdentity(item, identity));
        if (matched) {
            logStep('列表卡片命中刚学完跳过名单。', {
                cardId: identity.id,
                cardTitle: identity.title.slice(0, 80),
                skipId: matched.id,
                skipTitle: String(matched.title || '').slice(0, 80)
            });
            return true;
        }
        return false;
    }

    // 标记返回列表后需要刷新一次。
    function markListRefreshPending(reason) {
        window.localStorage.setItem(LIST_REFRESH_PENDING_KEY, '1');
        logStep('已标记列表页待刷新。', { reason });
    }

    // 列表页若存在待刷新标记，则清除标记并刷新一次；再次进入时不再刷新。
    function consumeListRefreshIfNeeded() {
        if (window.localStorage.getItem(LIST_REFRESH_PENDING_KEY) !== '1') return false;
        window.localStorage.removeItem(LIST_REFRESH_PENDING_KEY);
        logStep('检测到列表页待刷新标记，执行一次刷新并清除标记。');
        window.location.reload();
        return true;
    }

    // 判断当前 URL 是否为课程、文档或视频详情学习页。
    function isLearningDetailPage() {
        return isModulePath('kng') && /^\/(course|doc|video)\/play\b/.test(getHashRoute());
    }

    // 判断当前 URL 是否为云学堂资源扫描中转页，列表页进入详情页时会短暂经过这里。
    function isLearningScanPage() {
        return isModulePath('kng') && getHashRoute().startsWith('/scan');
    }

    // 获取当前详情页类型：课程、文档、视频或未知。
    function getLearningDetailType() {
        const route = getHashRoute();
        if (isModulePath('kng') && route.startsWith('/course/play')) return 'course';
        if (isModulePath('kng') && route.startsWith('/doc/play')) return 'doc';
        if (isModulePath('kng') && route.startsWith('/video/play')) return 'video';
        return 'unknown';
    }

    // 获取详情页右上角学习状态文本。
    function getLearningStatusText() {
        const summary = queryVisible(['.yxtulcdsdk-course-summary', '[class*="course-summary"]']);
        const text = summary ? (summary.innerText || summary.textContent || '').replace(/\s+/g, ' ').trim() : '';
        logStep('读取详情页学习状态。', { text });
        return text;
    }

    // 判断详情页是否已经完成学习。
    function isDetailCompleted() {
        const statusText = getLearningStatusText();
        return statusText.includes('已完成学习');
    }

    // 查找详情页左上角返回按钮。
    function findDetailBackButton() {
        logStep('查找详情页左上角返回按钮。');
        const button = queryVisible(['.yxtulcdsdk-play-goback', '[class*="play-goback"]', '[class*="goback"]']);
        logStep(button ? '已找到详情页返回按钮。' : '未找到详情页返回按钮。');
        return button;
    }

    // 查找详情页中“开始学习”或“继续学习”按钮。
    function findStudyActionButton() {
        logStep('查找详情页开始/继续学习按钮。');
        const button = Array.from(document.querySelectorAll('button, [role="button"], .yxtf-button')).find((element) => {
            const text = (element.innerText || element.textContent || '').replace(/\s+/g, '');
            return isVisible(element) && (text.includes('开始学习') || text.includes('继续学习'));
        }) || null;
        logStep(button ? '已找到开始/继续学习按钮。' : '未找到开始/继续学习按钮。');
        return button;
    }

    // 获取课程详情页左侧课程大纲列表项，只限定播放区左侧，避免误取页面底部课程大纲。
    function getCourseOutlineItems() {
        logStep('读取课程详情页左侧课程大纲列表。');
        const items = Array.from(document.querySelectorAll('.yxtulcdsdk-aside__wrap .yxtulcdsdk-catalog li')).filter(isVisible);
        logStep('课程大纲列表读取完成。', { count: items.length });
        return items;
    }

    // 获取课程大纲项的可点击容器。
    function getCourseOutlineClickable(item) {
        return item.querySelector('.hand.linozj, .linozj, .hand') || item;
    }

    // 获取课程大纲项文本，方便控制台排查当前处理到哪一项。
    function getCourseOutlineItemText(item) {
        return (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // 判断课程大纲项是否为当前激活任务。
    function isCourseOutlineItemActive(item) {
        const clickable = getCourseOutlineClickable(item);
        const className = `${item.className || ''} ${clickable.className || ''}`;
        return className.includes('liactive') || className.includes('active');
    }

    // 判断课程大纲项是否已经完成：完成项右侧 SVG 为带勾图标，HTML 中有白色描边标记。
    function isCourseOutlineItemCompleted(item) {
        const svg = item.querySelector('svg');
        const svgHtml = svg ? svg.outerHTML : '';
        const completed = /stroke="#FFF"|stroke-width="1\.5"|stroke="white"|stroke="#fff"/i.test(svgHtml);
        logStep(completed ? '课程大纲项已完成。' : '课程大纲项未完成或部分完成。', {
            text: getCourseOutlineItemText(item).slice(0, 120),
            active: isCourseOutlineItemActive(item)
        });
        return completed;
    }

    // 从上往下查找第一个未完成或部分完成的课程大纲项。
    function findFirstUnfinishedCourseOutlineItem() {
        const items = getCourseOutlineItems();
        const unfinished = items.find((item) => !isCourseOutlineItemCompleted(item)) || null;
        logStep(unfinished ? '已找到第一个需要学习的课程大纲项。' : '课程大纲中没有需要学习的项目。', {
            total: items.length,
            index: unfinished ? items.indexOf(unfinished) : -1,
            text: unfinished ? getCourseOutlineItemText(unfinished).slice(0, 160) : ''
        });
        return unfinished;
    }

    // 判断当前课程大纲项是否为视频任务。
    function isCourseOutlineVideoItem(item) {
        const text = getCourseOutlineItemText(item).replace(/\s+/g, '');
        return text.startsWith('视频') || text.includes('【视频】');
    }

    // 课程详情页优先按左侧课程大纲从上到下学习未完成或部分完成任务。
    function handleCourseOutlineLearning(settings) {
        const items = getCourseOutlineItems();
        if (!items.length) {
            logStep('课程详情页未找到左侧课程大纲，回退到原有详情页逻辑。');
            return false;
        }

        const unfinishedItem = findFirstUnfinishedCourseOutlineItem();
        if (!unfinishedItem) {
            return returnToListPage('课程左侧大纲全部完成');
        }

        const active = isCourseOutlineItemActive(unfinishedItem);
        const text = getCourseOutlineItemText(unfinishedItem);
        if (!active) {
            logStep('准备点击第一个未完成或部分完成的课程大纲项。', { text: text.slice(0, 180) });
            clickElement(getCourseOutlineClickable(unfinishedItem));
            return true;
        }

        logStep('第一个需要学习的课程大纲项已处于当前激活状态。', { text: text.slice(0, 180) });
        const studyButton = findStudyActionButton();
        if (studyButton) {
            logStep('当前课程大纲项存在开始/继续学习按钮，准备点击。');
            clickElement(studyButton);
        }
        if (isCourseOutlineVideoItem(unfinishedItem)) {
            ensureVideoPlayback();
        }
        return true;
    }

    // 查找当前页面中可见的业务弹窗，排除举报弹窗等非学习流程弹窗。
    function findVisibleDialog() {
        const selectors = [
            '.yxt-dialog',
            '.yxt-modal',
            '.el-dialog',
            '.el-message-box',
            '.ant-modal',
            '[role="dialog"]',
            '.yxt-dialog__wrapper',
            '.el-dialog__wrapper',
            '.el-message-box__wrapper',
            '.ant-modal-wrap',
            '[class*="modal"]',
            '[class*="dialog"]'
        ];
        const dialogs = Array.from(document.querySelectorAll(selectors.join(','))).filter((element) => {
            const style = window.getComputedStyle(element);
            const text = getVisibleText(element);
            return isVisible(element) && style.display !== 'none' && !/举报/.test(text);
        });
        const scoredDialogs = dialogs.map((element, index) => {
            const text = getVisibleText(element);
            const buttonCount = findDialogButtonCandidates(element, false).length;
            const className = String(element.className || '');
            const contentScore = /课程内容已更新|提示|继续学习|开始学习|确定|确认|知道了/.test(text) ? 1000 : 0;
            const reviewScore = /请留下您的评价|请对课程进行评分|分享你的见解/.test(text) ? 2000 : 0;
            const buttonScore = buttonCount ? 300 : 0;
            const wrapperPenalty = /wrapper|wrap|mask|overlay/i.test(className) ? 120 : 0;
            const emptyPenalty = text ? 0 : 500;
            return { element, text, buttonCount, score: reviewScore + contentScore + buttonScore + text.length - wrapperPenalty - emptyPenalty + index };
        });
        scoredDialogs.sort((a, b) => b.score - a.score);
        const dialog = scoredDialogs.length ? scoredDialogs[0].element : null;
        logStep(dialog ? '检测到可见业务弹窗。' : '未检测到可见业务弹窗。', {
            count: dialogs.length,
            chosenButtonCount: dialog ? findDialogButtonCandidates(dialog, false).length : 0,
            dialogText: dialog ? getVisibleText(dialog).slice(0, 160) : ''
        });
        return dialog;
    }

    // 判断弹窗按钮是否可点击，过滤禁用按钮和隐藏按钮。
    function isClickableDialogButton(button) {
        if (!button || !isVisible(button)) return false;
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
        const className = String(button.className || '');
        return !className.includes('is-disabled') && !className.includes('disabled');
    }

    // 识别弹窗内可点击控件。部分云学堂弹窗按钮是 div/span 渲染，不能只找 button。
    function findDialogButtonCandidates(root, includeLooseText) {
        if (!root) return [];
        const selector = [
            'button',
            'a',
            '[role="button"]',
            '[tabindex]',
            '.yxtf-button',
            '.yxt-button',
            '.el-button',
            '.ant-btn',
            '[class*="button"]',
            '[class*="btn"]',
            '[class*="primary"]',
            '[class*="confirm"]',
            '[class*="ok"]'
        ].join(',');
        const candidates = Array.from(root.querySelectorAll(selector));
        if (includeLooseText) {
            candidates.push(...Array.from(root.querySelectorAll('div, span, p')).filter((element) => {
                const text = getCompactText(element);
                if (!/^(确定|确认|知道了|我知道了|好的|好|继续|继续学习|开始学习|进入学习|同意|关闭|我已知晓)$/.test(text)) return false;
                const rect = element.getBoundingClientRect();
                return rect.width >= 40 && rect.height >= 20;
            }));
        }
        return Array.from(new Set(candidates)).filter(isClickableDialogButton);
    }

    // 有些弹窗按钮挂在 wrapper 同级或 teleport 到 body，按屏幕范围做一次保守兜底。
    function findGlobalDialogActionCandidates(dialog) {
        if (!dialog) return [];
        const dialogRect = dialog.getBoundingClientRect();
        return findDialogButtonCandidates(document.body, true).filter((button) => {
            if (dialog.contains(button)) return true;
            const rect = button.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            return centerX >= dialogRect.left && centerX <= dialogRect.right && centerY >= dialogRect.top && centerY <= dialogRect.bottom;
        });
    }

    // 识别课程学完后的评论弹窗（需填写见解并评分后才能发表）。
    function isCourseReviewDialog(dialog) {
        if (!dialog) return false;
        const text = getVisibleText(dialog);
        const hasReviewCopy = /请留下您的评价|请对课程进行评分|分享你的见解/.test(text);
        const hasReviewControls = Boolean(dialog.querySelector('textarea, .yxt-rate, .yxtf-textarea'));
        return hasReviewCopy || (/课程评论/.test(text) && /发表/.test(text) && hasReviewControls);
    }

    // 随机挑选一条课程评论见解。
    function pickRandomCourseReviewComment() {
        const index = Math.floor(Math.random() * COURSE_REVIEW_COMMENTS.length);
        return COURSE_REVIEW_COMMENTS[index] || COURSE_REVIEW_COMMENTS[0];
    }

    // 查找评论弹窗中的见解输入框。
    function findCourseReviewTextarea(dialog) {
        if (!dialog) return null;
        return Array.from(dialog.querySelectorAll('textarea.yxtf-textarea__inner, textarea')).find(isVisible) || null;
    }

    // 查找评论弹窗评分五角星，返回最后一颗（5 星）。
    function findCourseReviewFiveStar(dialog) {
        if (!dialog) return null;
        const rate = dialog.querySelector('.yxt-rate');
        if (!rate) return null;
        const items = Array.from(rate.querySelectorAll('.yxt-rate__item')).filter(isVisible);
        return items.length ? items[items.length - 1] : null;
    }

    // 判断评论弹窗是否已经选中评分（至少 1 星）。
    function isCourseReviewRated(dialog) {
        if (!dialog) return false;
        const rate = dialog.querySelector('.yxt-rate');
        if (!rate) return false;
        const valueNow = Number(rate.getAttribute('aria-valuenow') || 0);
        if (valueNow > 0) return true;
        return Array.from(rate.querySelectorAll('.yxt-rate__icon')).some((icon) => {
            const color = window.getComputedStyle(icon).color || '';
            return color && !/rgb\(\s*217\s*,\s*217\s*,\s*217\s*\)|#d9d9d9/i.test(color);
        });
    }

    // 查找评论弹窗“发表”按钮；includeDisabled 为 true 时也返回禁用态按钮。
    function findCourseReviewSubmitButton(dialog, includeDisabled) {
        if (!dialog) return null;
        const buttons = Array.from(dialog.querySelectorAll('button, .yxtf-button, [role="button"], [class*="button"]')).filter((button) => {
            if (!isVisible(button)) return false;
            if (!/^发表$/.test(getCompactText(button))) return false;
            if (includeDisabled) return true;
            return isClickableDialogButton(button);
        });
        return buttons[0] || null;
    }

    // 填写见解、选择五星评分，并在“发表”可点后提交课程评论；分步间隔 1 秒。
    function handleCourseReviewDialog(dialog) {
        if (state.courseReviewSubmitting) {
            logStep('课程评论流程执行中，跳过重复触发。');
            return true;
        }

        state.courseReviewSubmitting = true;
        logStep('开始课程评论分步流程，步骤间隔 1 秒。');

        const waitOneSecond = () => new Promise((resolve) => window.setTimeout(resolve, 1000));
        const getReviewDialog = () => {
            const current = findVisibleDialog();
            return current && isCourseReviewDialog(current) ? current : null;
        };

        (async () => {
            try {
                let currentDialog = dialog && isCourseReviewDialog(dialog) ? dialog : getReviewDialog();
                if (!currentDialog) {
                    logStep('课程评论弹窗已消失，结束评论流程。');
                    return;
                }

                const textarea = findCourseReviewTextarea(currentDialog);
                if (!textarea) {
                    logStep('课程评论弹窗未找到见解输入框，结束本轮评论流程。');
                    return;
                }

                const currentComment = (textarea.value || '').trim();
                if (!currentComment) {
                    const comment = pickRandomCourseReviewComment();
                    logStep('步骤1：填写课程评论见解。', { comment });
                    setNativeValue(textarea, comment);
                    textarea.focus();
                    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
                } else {
                    logStep('步骤1：课程评论见解已存在，跳过填写。', { comment: currentComment.slice(0, 40) });
                }

                await waitOneSecond();
                currentDialog = getReviewDialog();
                if (!currentDialog) {
                    logStep('填写见解后评论弹窗已关闭，结束评论流程。');
                    return;
                }

                if (!isCourseReviewRated(currentDialog)) {
                    const fiveStar = findCourseReviewFiveStar(currentDialog);
                    if (!fiveStar) {
                        logStep('步骤2：未找到五角星评分，结束本轮评论流程。');
                        return;
                    }
                    logStep('步骤2：点击五星课程评分。');
                    clickElement(fiveStar);
                } else {
                    logStep('步骤2：课程评分已完成，跳过点星。');
                }

                await waitOneSecond();
                currentDialog = getReviewDialog();
                if (!currentDialog) {
                    logStep('评分后评论弹窗已关闭，结束评论流程。');
                    return;
                }

                let submitButton = findCourseReviewSubmitButton(currentDialog, true);
                if (!submitButton) {
                    logStep('步骤3：未找到发表按钮，结束本轮评论流程。');
                    return;
                }

                if (!isClickableDialogButton(submitButton)) {
                    logStep('步骤3：发表按钮暂不可点，再等 1 秒后重试。');
                    await waitOneSecond();
                    currentDialog = getReviewDialog();
                    if (!currentDialog) {
                        logStep('等待发表时可点时弹窗已关闭，结束评论流程。');
                        return;
                    }
                    submitButton = findCourseReviewSubmitButton(currentDialog, true);
                    if (!submitButton || !isClickableDialogButton(submitButton)) {
                        logStep('步骤3：发表按钮仍不可点击，结束本轮评论流程，等待下次检查重试。');
                        return;
                    }
                }

                const latestTextarea = findCourseReviewTextarea(currentDialog);
                logStep('步骤3：点击发表课程评论。', {
                    comment: ((latestTextarea && latestTextarea.value) || '').trim().slice(0, 40),
                    buttonText: getVisibleText(submitButton).slice(0, 40)
                });
                clickElement(submitButton);

                await waitOneSecond();
                const stillOpen = getReviewDialog();
                if (stillOpen) {
                    logStep('发表后评论弹窗仍在，等待下次检查重试。');
                } else {
                    logStep('课程评论发表完成或弹窗已关闭。');
                }
            } catch (error) {
                console.error('[云学堂自动化脚本] 课程评论分步流程异常。', error);
            } finally {
                state.courseReviewSubmitting = false;
            }
        })();

        return true;
    }

    // 查找弹窗右上角关闭按钮，兼容图标按钮、文本 x/× 和组件库 close class。
    function findDialogCloseButton(dialog) {
        if (!dialog) return null;
        const dialogRect = dialog.getBoundingClientRect();
        const explicitButton = Array.from(dialog.querySelectorAll('.yxtf-dialog__headerbtn, button[aria-label="Close"], button[aria-label="close"], button[aria-label*="关闭"], .yxtf-dialog__close')).find(isClickableDialogButton);
        if (explicitButton) {
            const button = explicitButton.closest('button') || explicitButton;
            logStep('已通过云学堂关闭按钮选择器找到弹窗右上角关闭按钮。', {
                closeButtonText: getVisibleText(button).slice(0, 80),
                className: String(button.className || '')
            });
            return button;
        }
        const candidates = Array.from(dialog.querySelectorAll([
            'button',
            '[role="button"]',
            '.yxtf-dialog__headerbtn',
            '.yxtf-dialog__close',
            '[aria-label*="关闭"]',
            '[aria-label*="Close"]',
            '[title*="关闭"]',
            '[class*="close"]',
            '[class*="Close"]',
            '[class*="icon-close"]',
            '[class*="dialog__close"]',
            'i',
            'svg',
            'span',
            'div'
        ].join(','))).filter((element) => {
            if (!isClickableDialogButton(element)) return false;
            const text = getCompactText(element);
            const label = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${String(element.className || '')}`;
            const rect = element.getBoundingClientRect();
            const inTopRight = rect.left >= dialogRect.left + dialogRect.width * 0.72 && rect.top <= dialogRect.top + dialogRect.height * 0.2;
            const looksClose = /关闭|close/i.test(label) || /^(x|X|×|✕)$/.test(text);
            return looksClose || inTopRight;
        });
        candidates.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const aDistance = Math.abs(dialogRect.right - ar.right) + Math.abs(dialogRect.top - ar.top);
            const bDistance = Math.abs(dialogRect.right - br.right) + Math.abs(dialogRect.top - br.top);
            return aDistance - bDistance;
        });
        const button = candidates[0] || null;
        logStep(button ? '已找到弹窗右上角关闭按钮。' : '未找到弹窗右上角关闭按钮。', {
            closeButtonCount: candidates.length,
            closeButtonText: button ? getVisibleText(button).slice(0, 80) : ''
        });
        return button;
    }

    // 在弹窗内部查找最适合点击的按钮，优先点击确认、继续、知道了等正向按钮。
    function findDialogActionButton(dialog) {
        const candidates = findDialogButtonCandidates(dialog, true);
        const allCandidates = candidates.length ? candidates : findGlobalDialogActionCandidates(dialog);
        const positiveText = /^(确定|确认|知道了|我知道了|好的|好|继续|继续学习|开始学习|进入学习|同意|关闭|我已知晓)$/;
        const containsPositiveText = /确定|确认|知道了|我知道了|好的|继续|继续学习|开始学习|进入学习|同意|关闭|我已知晓/;
        const byExactText = allCandidates.find((button) => positiveText.test(getCompactText(button)));
        const byContainsText = allCandidates.find((button) => containsPositiveText.test(getCompactText(button)));
        const byPrimaryClass = allCandidates.find((button) => /primary|confirm|ok|sure/i.test(String(button.className || '')));
        const footerButtons = allCandidates.filter((button) => button.closest('.yxt-dialog__footer, .el-dialog__footer, .ant-modal-footer, [class*="footer"]'));
        const byFooterLast = footerButtons.length ? footerButtons[footerButtons.length - 1] : null;
        const button = byExactText || byContainsText || byPrimaryClass || byFooterLast || allCandidates[0] || null;
        logStep(button ? '已找到弹窗操作按钮。' : '未找到弹窗可点击按钮。', {
            buttonCount: allCandidates.length,
            localButtonCount: candidates.length,
            buttonText: button ? getVisibleText(button).slice(0, 80) : ''
        });
        return button;
    }

    // 处理当前可见弹窗：课程评论走填写发表流程，其他弹窗点击操作按钮。
    function clickVisibleDialogButton() {
        const dialog = findVisibleDialog();
        if (!dialog) {
            state.courseReviewSubmitting = false;
            return false;
        }
        if (isCourseReviewDialog(dialog)) {
            logStep('检测到课程评论弹窗，准备自动填写并发表。', {
                dialogText: getVisibleText(dialog).slice(0, 160)
            });
            return handleCourseReviewDialog(dialog);
        }
        const button = findDialogActionButton(dialog);
        if (!button) {
            logStep('弹窗存在但没有可点击按钮，本轮等待下次检查。');
            return true;
        }
        logStep('准备点击弹窗按钮。', {
            dialogText: getVisibleText(dialog).slice(0, 160),
            buttonText: getVisibleText(button).slice(0, 80)
        });
        clickElement(button);
        return true;
    }

    // 检查页面是否出现加载失败或错误提示。
    function hasPageFailure() {
        const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
        const hasFailureText = /加载失败|加载异常|网络异常|页面出错|出错了|系统异常|请刷新|重试/.test(bodyText);
        if (hasFailureText) {
            logStep('检测到页面加载失败或错误提示，准备刷新。', {
                matched: true,
                bodyText: bodyText.slice(0, 160)
            });
        }
        return hasFailureText;
    }

    // 检查弹窗或异常页面：弹窗优先点击按钮，加载失败再刷新页面。
    function handleDialogOrReloadOnFailure() {
        if (clickVisibleDialogButton()) return true;
        if (!hasPageFailure()) return false;
        window.location.reload();
        return true;
    }

    // 点击详情页返回按钮，回到列表页继续查找未学完内容。
    function returnToListPage(reason) {
        if (state.detailBackClicked) {
            logStep('跳过返回列表页：已经点击过返回。');
            return false;
        }
        const backButton = findDetailBackButton();
        if (!backButton) return false;
        state.detailBackClicked = true;
        rememberCompletedLearningItem();
        markListRefreshPending(reason);
        logStep('准备返回在线课堂列表页。', { reason });
        clickElement(backButton);
        window.setTimeout(() => {
            if (isLearningDetailPage()) {
                const fallbackUrl = getFallbackListUrl();
                logStep('点击返回后仍在详情页，使用最近记录的列表页 URL 兜底跳转。', { target: fallbackUrl });
                location.href = fallbackUrl;
            }
        }, 1500);
        return true;
    }

    // 从 URL rate 参数读取目标倍速，未指定时默认使用 2 倍速。
    function getTargetPlaybackRate() {
        const rawRate = getHashRouteParam('rate');
        if (rawRate === null || rawRate === '') return 2;
        const rate = Number(rawRate);
        if (!Number.isFinite(rate) || rate <= 0) return 0;
        return Math.min(Math.max(rate, 0.25), 4);
    }

    // 判断当前 video 是否已接近目标倍速。
    function isPlaybackRateApplied(video, targetRate) {
        return targetRate > 0 && Math.abs(Number(video.playbackRate || 1) - targetRate) < 0.05;
    }

    // 只有视频已经正常播放后再切倍速，避免播放器尚未初始化时点倍速菜单失败。
    function isVideoPlayingNormally(video) {
        return video && !video.paused && !video.ended && video.readyState >= 2 && Number(video.currentTime || 0) > 0;
    }

    // 格式化倍速文本，用于匹配 JW Player 菜单项。
    function formatPlaybackRateText(rate) {
        return Number.isInteger(rate) ? String(rate) : String(rate).replace(/0+$/, '').replace(/\.$/, '');
    }

    // 查找 JW Player 倍速菜单中的目标选项。
    function findJwPlaybackRateOption(targetRate, includeHiddenPlayrateItems) {
        const rateText = formatPlaybackRateText(targetRate);
        const escapedRateText = rateText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactPattern = new RegExp(`^(?:${escapedRateText}(?:\\.0)?(?:x|X|倍)?|[xX×*]${escapedRateText}(?:\\.0)?)$`);
        const menuSelectors = [
            '.jw-icon-playrate.jw-open',
            '.jw-icon-playrate',
            '[class*="jw-icon-playrate"]',
            '.jw-settings-open .jw-settings-submenu',
            '.jw-settings-menu',
            '.jw-menu',
            '.jw-controlbar',
            '.jwplayer',
            document.body
        ];
        for (const root of menuSelectors.map((selector) => typeof selector === 'string' ? document.querySelector(selector) : selector).filter(Boolean)) {
            const options = Array.from(root.querySelectorAll([
                '.jw-option',
                '[class*="option"]',
                '.jw-settings-content-item',
                '.jw-settings-submenu .jw-reset',
                '.jw-icon-playrate .jw-reset',
                '[role="menuitem"]',
                '[aria-label]',
                'button',
                'div',
                'span'
            ].join(','))).filter((element) => isVisible(element) || (includeHiddenPlayrateItems && element.closest('.jw-icon-playrate')));
            const option = options.find((element) => {
                const text = getCompactText(element);
                const label = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`.replace(/\s+/g, '');
                return exactPattern.test(text) || exactPattern.test(label) || text === `${rateText}x` || text === `×${rateText}` || label.includes(`${rateText}x`) || label.includes(`×${rateText}`);
            });
            if (option) return option;
        }
        return null;
    }

    // 通过页面 JW Player 倍速控件设置倍速，避免只改 video.playbackRate 不被平台认可。
    function ensureJwPlaybackRate(targetRate) {
        if (!targetRate) return false;
        const playrateButton = queryVisible([
            '.jw-icon-playrate',
            '.jw-icon-tooltip.jw-icon-playrate',
            '[class*="jw-icon-playrate"]',
            '[aria-label*="Playback Rate"]',
            '[aria-label*="倍速"]',
            '[aria-label*="播放速度"]'
        ]) || Array.from(document.querySelectorAll('.jw-icon-playrate, [class*="jw-icon-playrate"]')).find((element) => document.documentElement.contains(element));
        if (!playrateButton) {
            logStep('未找到 JW Player 倍速按钮。', { targetRate });
            return false;
        }

        const currentText = `${getVisibleText(playrateButton)} ${playrateButton.getAttribute('aria-label') || ''}`.replace(/\s+/g, '');
        const rateText = formatPlaybackRateText(targetRate);
        if (currentText === `${rateText}x` || currentText === `×${rateText}` || currentText === `${rateText}倍`) {
            logStep('JW Player 倍速按钮显示已是目标倍速。', { targetRate, currentText });
            return true;
        }

        const optionBeforeOpen = findJwPlaybackRateOption(targetRate, false);
        if (optionBeforeOpen) {
            logStep('已找到可见的 JW Player 倍速菜单目标选项，准备点击。', { targetRate, optionText: getVisibleText(optionBeforeOpen).slice(0, 80) });
            clickElement(optionBeforeOpen);
            return true;
        }

        if (!String(playrateButton.className || '').includes('jw-open')) {
            logStep('准备点击 JW Player 倍速按钮展开菜单。', {
                targetRate,
                buttonText: getVisibleText(playrateButton).slice(0, 80),
                ariaLabel: playrateButton.getAttribute('aria-label') || ''
            });
            clickElement(playrateButton);
        } else {
            logStep('JW Player 倍速菜单已展开，准备查找目标选项。', { targetRate });
        }

        window.setTimeout(() => {
            const option = findJwPlaybackRateOption(targetRate, false) || findJwPlaybackRateOption(targetRate, true);
            if (!option) {
                logStep('JW Player 倍速菜单展开后仍未找到目标选项。', { targetRate });
                return;
            }
            logStep('准备点击 JW Player 倍速目标选项。', { targetRate, optionText: getVisibleText(option).slice(0, 80) });
            clickElement(option);
        }, 300);
        return true;
    }

    // 控制详情页视频：自动播放，并在暂停时恢复播放。
    function ensureVideoPlayback() {
        const videos = Array.from(document.querySelectorAll('video')).filter((video) => {
            const hasMedia = video.readyState > 0 || Number.isFinite(video.duration);
            return hasMedia && (isVisible(video) || video.readyState > 0);
        });
        if (!videos.length) {
            logStep('当前详情页未发现 video 元素。');
            return false;
        }
        const targetRate = getTargetPlaybackRate();
        videos.forEach((video, index) => {
            try {
                video.muted = true;
                if (video.paused && !video.ended) {
                    const playResult = video.play();
                    if (playResult && typeof playResult.catch === 'function') {
                        playResult.catch((error) => logStep('视频自动播放被浏览器阻止或暂时失败。', { index, message: error.message }));
                    }
                }
                if (targetRate && !isPlaybackRateApplied(video, targetRate)) {
                    if (isVideoPlayingNormally(video)) {
                        ensureJwPlaybackRate(targetRate);
                    } else {
                        logStep('视频尚未进入正常播放状态，暂不切换倍速。', {
                            index,
                            paused: video.paused,
                            ended: video.ended,
                            currentTime: Math.round(video.currentTime || 0),
                            readyState: video.readyState,
                            targetRate
                        });
                    }
                }
                logStep('视频播放状态检查完成。', {
                    index,
                    paused: video.paused,
                    ended: video.ended,
                    currentTime: Math.round(video.currentTime || 0),
                    duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
                    readyState: video.readyState,
                    playbackRate: video.playbackRate,
                    targetRate: targetRate || null
                });
            } catch (error) {
                console.error('[云学堂自动化脚本] 视频播放控制异常。', error);
            }
        });
        return true;
    }

    // 判断课程详情页顶部进度是否显示所有任务已完成。
    function isCourseAllTasksCompleted() {
        const statusText = getLearningStatusText();
        const match = statusText.match(/已完成\s*(\d+)\s*\/\s*(\d+)/);
        if (!match) return statusText.includes('已完成学习');
        const completed = Number(match[1]);
        const total = Number(match[2]);
        const done = total > 0 && completed >= total;
        logStep('课程任务完成度判断。', { completed, total, done });
        return done;
    }

    // 执行一次详情页学习状态检查。
    function runLearningDetailCheck(settings, source) {
        logStep('执行详情页学习检查。', { source, type: getLearningDetailType(), ...safeSettingsInfo(settings), href: location.href });
        if (!settings.enabled || !settings.detailAutoStudyEnabled) {
            logStep('跳过详情页学习检查：未启用自动化或详情页自动学习。');
            return false;
        }
        if (!isLearningDetailPage()) {
            logStep('跳过详情页学习检查：当前不是详情页。');
            return false;
        }
        if (handleDialogOrReloadOnFailure()) return true;

        const detailType = getLearningDetailType();
        if (isDetailCompleted()) {
            return returnToListPage('右上角显示已完成学习');
        }

        if (detailType === 'course' && isCourseAllTasksCompleted()) {
            return returnToListPage('课程任务进度已全部完成');
        }

        if (detailType === 'course' && handleCourseOutlineLearning(settings)) {
            return true;
        }

        const studyButton = findStudyActionButton();
        if (studyButton) {
            logStep('准备点击开始/继续学习按钮。');
            clickElement(studyButton);
        }

        if (detailType === 'video' || detailType === 'course') {
            ensureVideoPlayback();
        }

        return true;
    }

    // 安排详情页首次 30 秒延迟和后续定时检查。
    function scheduleLearningDetailAutomation(source) {
        if (state.detailStarted) {
            logStep('详情页学习检查已启动，跳过重复启动。');
            return;
        }
        const settings = loadSettings();
        if (!settings.enabled || !settings.detailAutoStudyEnabled) {
            logStep('详情页自动学习未启用。');
            return;
        }
        state.detailStarted = true;
        const initialDelay = normalizeSeconds(settings.detailInitialDelayMs, DEFAULT_SETTINGS.detailInitialDelayMs);
        const interval = normalizeSeconds(settings.detailCheckIntervalMs, DEFAULT_SETTINGS.detailCheckIntervalMs);
        logStep('安排详情页学习检查。', { source, initialDelay, interval });
        window.clearTimeout(state.detailInitialTimer);
        window.clearInterval(state.detailCheckTimer);
        state.detailInitialTimer = window.setTimeout(() => {
            runLearningDetailCheck(loadSettings(), '详情页首次检查');
            state.detailCheckTimer = window.setInterval(() => {
                if (!isLearningDetailPage()) {
                    logStep('已离开详情页，停止详情页定时检查。');
                    window.clearInterval(state.detailCheckTimer);
                    state.detailStarted = false;
                    return;
                }
                runLearningDetailCheck(loadSettings(), '详情页定时检查');
            }, secondsToMs(interval));
        }, secondsToMs(initialDelay));
    }

    // 判断卡片文本中是否包含课程、视频或文档类型。
    function isLearningResourceCard(card) {
        const text = (card.innerText || card.textContent || '').replace(/\s+/g, '');
        return /课程|视频|文档/.test(text);
    }

    // 判断课程列表卡片是否已经显示“已学完”标签。
    function isCompletedLearningCard(card) {
        const text = (card.innerText || card.textContent || '').replace(/\s+/g, '');
        return text.includes('已学完');
    }

    // 判断列表卡片是否应跳过：已学完，或命中刚学完跳过名单。
    function shouldSkipLearningCard(card) {
        if (isCompletedLearningCard(card)) return true;
        return isSkippedCompletedLearningCard(card);
    }

    // 获取当前在线课堂列表页中可见的课程、视频或文档卡片。
    function findLearningCards() {
        logStep('查找在线课堂列表页课程/视频/文档卡片。');
        const cards = Array.from(document.querySelectorAll('li.kng-list-new__item, .kng-list-new__item')).filter((card) => {
            return isVisible(card) && isLearningResourceCard(card);
        });
        logStep('在线课堂列表页卡片查找结果。', { count: cards.length });
        return cards;
    }

    // 在当前页查找第一个未学完且不在跳过名单中的课程、视频或文档卡片。
    function findFirstUnfinishedLearningCard() {
        const cards = findLearningCards();
        const unfinished = cards.find((card) => !shouldSkipLearningCard(card)) || null;
        logStep(unfinished ? '已找到未学完卡片。' : '当前页未找到可学习卡片。', {
            total: cards.length,
            completed: cards.filter(isCompletedLearningCard).length,
            skipped: cards.filter(matchesSkipCompletedLearningCard).length,
            unfinishedText: unfinished ? (unfinished.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) : ''
        });
        return unfinished;
    }

    // 查找分页中的“下一页”按钮，当前页全部学完时使用。
    function findNextPageButton() {
        logStep('查找在线课堂列表页下一页按钮。');
        const nextButton = Array.from(document.querySelectorAll('.yxtf-pagination .btn-next, button.btn-next')).find((button) => {
            const disabled = button.disabled || button.getAttribute('disabled') !== null || String(button.className).includes('disabled');
            return isVisible(button) && !disabled;
        }) || null;
        logStep(nextButton ? '已找到可点击的下一页按钮。' : '未找到可点击的下一页按钮。');
        return nextButton;
    }

    // 执行在线课堂列表页自动查找：优先点击未学完卡片，否则翻到下一页继续找。
    function openUnfinishedLearningItem(settings, source) {
        logStep('准备执行在线课堂列表页未学完内容查找流程。', { source, ...safeSettingsInfo(settings), href: location.href });
        if (!settings.enabled) {
            logStep('跳过列表页查找：未启用自动化。');
            return false;
        }
        if (!settings.listAutoOpenEnabled) {
            logStep('跳过列表页查找：未启用列表页自动打开未学完内容。');
            return false;
        }
        if (!isTargetListPage()) {
            logStep('跳过列表页查找：当前 URL 不是目标在线课堂列表页。', { href: location.href });
            return false;
        }
        if (state.listActionScheduled || state.listItemClicked || state.listPageTurning) {
            logStep('跳过列表页查找：流程已安排、已点击或正在翻页。');
            return false;
        }

        state.listActionScheduled = true;
        const delaySeconds = normalizeSeconds(settings.listActionDelayMs, DEFAULT_SETTINGS.listActionDelayMs);
        logStep(`在线课堂列表页将在 ${delaySeconds} 秒后查找未学完内容。`);
        window.setTimeout(() => {
            try {
                state.listActionScheduled = false;
                if (!isTargetListPage()) {
                    logStep('取消列表页查找：延迟后已不在目标列表页。', { href: location.href });
                    return;
                }

                const unfinishedCard = findFirstUnfinishedLearningCard();
                if (unfinishedCard) {
                    state.listItemClicked = true;
                    logStep('准备点击第一个未学完卡片。', {
                        text: (unfinishedCard.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200)
                    });
                    clickElement(unfinishedCard);
                    logStep('未学完卡片点击完成。');
                    return;
                }

                const nextButton = findNextPageButton();
                if (nextButton) {
                    state.listPageTurning = true;
                    logStep('当前页没有可学习卡片（已学完或刚学完跳过），准备点击下一页。');
                    clickElement(nextButton);
                    window.setTimeout(() => {
                        state.listPageTurning = false;
                        state.listActionScheduled = false;
                        logStep('下一页点击后重置列表页查找状态。');
                        maybeOpenUnfinishedLearningItem('翻页后检查');
                    }, 2500);
                    return;
                }

                logStep('当前页没有未学完内容，也没有可点击的下一页。');
            } catch (error) {
                state.listActionScheduled = false;
                state.listPageTurning = false;
                console.error('[云学堂自动化脚本] 在线课堂列表页查找流程异常。', error);
            }
        }, secondsToMs(delaySeconds));

        return true;
    }

    // 在首页查找文字为“查看全部”的可点击入口。
    function findViewAllButton() {
        logStep('查找首页“查看全部”按钮。');
        const candidates = Array.from(document.querySelectorAll('button, a, span, div')).filter((element) => {
            const text = (element.innerText || element.textContent || '').replace(/\s+/g, '').trim();
            return text === '查看全部' && isVisible(element);
        });
        const button = candidates.find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }) || null;
        logStep(button ? '已找到首页“查看全部”按钮。' : '未找到首页“查看全部”按钮。', {
            candidateCount: candidates.length
        });
        return button;
    }

    // 从首页已有链接中查找在线课堂列表入口，避免写死测试账号 cid。
    function findHomeListUrl() {
        logStep('查找首页在线课堂列表链接。');
        const link = Array.from(document.querySelectorAll('a[href]')).find((anchor) => {
            return isVisible(anchor) && isLearningListUrl(anchor.href);
        }) || null;
        logStep(link ? '已找到首页在线课堂列表链接。' : '未找到首页在线课堂列表链接。', {
            href: link ? link.href : ''
        });
        return link ? link.href : '';
    }

    // 按配置在首页延迟点击“查看全部”，必要时使用目标 URL 兜底跳转。
    function clickHomeViewAll(settings, source) {
        logStep('准备执行首页点击“查看全部”流程。', { source, ...safeSettingsInfo(settings), href: location.href });
        if (!settings.enabled) {
            logStep('跳过首页点击“查看全部”：未启用自动登录/自动化。');
            return false;
        }
        if (!settings.homeAutoViewAllEnabled) {
            logStep('跳过首页点击“查看全部”：未启用首页自动点击。');
            return false;
        }
        if (isTargetListPage()) {
            logStep('跳过首页点击“查看全部”：当前已经在目标列表页。');
            return false;
        }
        if (!isHomeIndexPage()) {
            logStep('跳过首页点击“查看全部”：当前不是首页。');
            return false;
        }
        if (state.homeViewAllScheduled || state.homeViewAllClicked) {
            logStep('跳过首页点击“查看全部”：流程已安排或已执行。');
            return false;
        }

        state.homeViewAllScheduled = true;
        const delaySeconds = normalizeSeconds(settings.homeViewAllDelayMs, DEFAULT_SETTINGS.homeViewAllDelayMs);
        logStep(`首页将在 ${delaySeconds} 秒后点击“查看全部”。`);
        window.setTimeout(() => {
            try {
                if (state.homeViewAllClicked) {
                    logStep('取消首页点击“查看全部”：已经执行过。');
                    return;
                }
                if (isTargetListPage()) {
                    logStep('取消首页点击“查看全部”：当前已经在目标列表页。');
                    state.homeViewAllClicked = true;
                    return;
                }
                if (!isHomeIndexPage()) {
                    logStep('取消首页点击“查看全部”：延迟后已不在首页。', { href: location.href });
                    state.homeViewAllScheduled = false;
                    return;
                }

                const button = findViewAllButton();
                if (button) {
                    state.homeViewAllClicked = true;
                    logStep('准备点击首页“查看全部”按钮。');
                    clickElementInCurrentPage(button);
                    logStep('首页“查看全部”按钮点击完成。');
                    return;
                }

                const listUrl = findHomeListUrl();
                if (listUrl) {
                    state.homeViewAllClicked = true;
                    logStep('未找到“查看全部”按钮，使用首页已有列表链接兜底跳转。', { target: listUrl });
                    openInCurrentPage(listUrl, '首页列表链接兜底');
                    return;
                }

                state.homeViewAllScheduled = false;
                logStep('未找到“查看全部”按钮，也未找到在线课堂列表链接，本轮首页流程结束。');
            } catch (error) {
                state.homeViewAllScheduled = false;
                console.error('[云学堂自动化脚本] 首页点击“查看全部”流程异常。', error);
            }
        }, secondsToMs(delaySeconds));

        return true;
    }

    // 首页入口：只在首页触发“查看全部”检查。
    function maybeHomeViewAll(source) {
        logStep('收到首页“查看全部”检查请求。', {
            source,
            homeViewAllScheduled: state.homeViewAllScheduled,
            homeViewAllClicked: state.homeViewAllClicked,
            href: location.href
        });
        if (!isHomeIndexPage()) {
            logStep('跳过首页“查看全部”检查：当前 URL 不是首页。', { href: location.href });
            return;
        }
        clickHomeViewAll(loadSettings(), source);
    }

    // 在线课堂列表页入口：只在目标列表页触发未学完内容查找。
    function maybeOpenUnfinishedLearningItem(source) {
        logStep('收到在线课堂列表页未学完内容检查请求。', {
            source,
            listActionScheduled: state.listActionScheduled,
            listItemClicked: state.listItemClicked,
            listPageTurning: state.listPageTurning,
            href: location.href
        });
        if (!isTargetListPage()) {
            logStep('跳过在线课堂列表页检查：当前 URL 不是目标列表页。', { href: location.href });
            return;
        }
        rememberCurrentListUrl();
        if (consumeListRefreshIfNeeded()) return;
        openUnfinishedLearningItem(loadSettings(), source);
    }

    // 处理 /kng/#/scan 中转页：等待站点重定向到课程、文档或视频学习页。
    function waitForScanRedirect(source) {
        if (state.scanTransitionTimer) {
            logStep('资源扫描中转页等待已启动，跳过重复启动。', { source, href: location.href });
            return;
        }
        logStep('当前 URL 是资源扫描中转页，等待跳转到真实学习页。', { source, href: location.href });
        let count = 0;
        state.scanTransitionTimer = window.setInterval(() => {
            count += 1;
            if (isLearningDetailPage()) {
                window.clearInterval(state.scanTransitionTimer);
                state.scanTransitionTimer = 0;
                resetLearningDetailState('扫描中转页跳转到学习详情页');
                logStep('资源扫描中转完成，准备执行学习详情页检查。', { href: location.href, count });
                runAutomationChecks('扫描中转完成');
                return;
            }
            if (!isLearningScanPage()) {
                window.clearInterval(state.scanTransitionTimer);
                state.scanTransitionTimer = 0;
                logStep('已离开资源扫描中转页，停止等待。', { href: location.href, count });
                runAutomationChecks('离开扫描中转页');
                return;
            }
            if (count >= 20) {
                window.clearInterval(state.scanTransitionTimer);
                state.scanTransitionTimer = 0;
                logStep('资源扫描中转等待超时，刷新页面重新尝试。', { href: location.href });
                window.location.reload();
            }
        }, 1000);
    }

    // 清理资源扫描中转页等待器，避免跳转到真实学习页后重复启动详情页检查。
    function clearScanTransitionTimer(reason) {
        if (!state.scanTransitionTimer) return;
        window.clearInterval(state.scanTransitionTimer);
        state.scanTransitionTimer = 0;
        logStep('清理资源扫描中转页等待器。', { reason, href: location.href });
    }

    // 根据当前 URL 分发自动化检查，避免所有页面都执行所有逻辑。
    function runAutomationChecks(source) {
        const routeKey = isLoginPage() ? 'login' : isHomeIndexPage() ? 'home' : isTargetListPage() ? 'list' : isLearningDetailPage() ? 'detail' : isLearningScanPage() ? 'scan' : 'other';
        const shouldLogOther = routeKey !== 'other' || state.lastRouteKey !== routeKey || source !== '页面变化';
        state.lastRouteKey = routeKey;

        if (routeKey === 'other' && !shouldLogOther) return;

        logStep('执行自动化检查。', { source, href: location.href });
        if (routeKey === 'login') {
            logStep('当前 URL 是登录页，仅执行登录检查。');
            maybeAutoLogin(source);
            return;
        }
        if (routeKey === 'home') {
            logStep('当前 URL 是首页，仅执行首页“查看全部”检查。');
            maybeHomeViewAll(source);
            return;
        }
        if (routeKey === 'list') {
            logStep('当前 URL 是在线课堂列表页，仅执行未学完内容查找。');
            maybeOpenUnfinishedLearningItem(source);
            return;
        }
        if (routeKey === 'detail') {
            logStep('当前 URL 是学习详情页，仅安排详情页学习检查。');
            scheduleLearningDetailAutomation(source);
            return;
        }
        if (routeKey === 'scan') {
            waitForScanRedirect(source);
            return;
        }
        logStep('当前 URL 不匹配登录页、首页、在线课堂列表页、扫描中转页或学习详情页，不执行自动化检查。');
    }

    // 重置详情页学习检查状态和定时器。
    function resetLearningDetailState(reason) {
        window.clearTimeout(state.detailInitialTimer);
        window.clearInterval(state.detailCheckTimer);
        state.detailInitialTimer = 0;
        state.detailCheckTimer = 0;
        state.detailStarted = false;
        state.detailBackClicked = false;
        state.courseReviewSubmitting = false;
        logStep('重置详情页学习检查状态。', { reason });
    }

    // 简单防抖工具，减少 DOM 高频变化时的重复检查和日志。
    function debounce(fn, delayMs) {
        let timer = 0;
        return function debounced(...args) {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), delayMs);
        };
    }

    // 创建左下角设置面板所需样式。
    function createStyles() {
        logStep('创建设置面板样式。');
        const style = document.createElement('style');
        style.textContent = `
      #zqyl-auto-login-root {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #172033;
      }
      #zqyl-auto-login-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border: 0;
        border-radius: 14px;
        color: #fff;
        background: linear-gradient(180deg, #1d7c9b 0%, #176b87 100%);
        box-shadow: 0 12px 28px rgba(23, 107, 135, 0.24);
        cursor: pointer;
      }
      #zqyl-auto-login-button:hover {
        background: #11576e;
      }
      #zqyl-auto-login-button svg {
        width: 26px;
        height: 26px;
        pointer-events: none;
      }
      #zqyl-auto-login-panel {
        position: absolute;
        right: 0;
        bottom: 70px;
        width: 386px;
        height: min(640px, calc(100vh - 96px));
        overflow: hidden;
        box-sizing: border-box;
        border: 1px solid #dfe7ef;
        border-radius: 10px;
        background: #f8fafc;
        box-shadow: 0 18px 48px rgba(16, 24, 40, 0.18);
        padding: 0;
      }
      #zqyl-auto-login-panel[hidden] {
        display: none;
      }
      .zqyl-auto-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px;
        min-height: 72px;
        box-sizing: border-box;
        border-bottom: 1px solid #e7eef5;
        background: #fff;
      }
      .zqyl-auto-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: #172033;
      }
      .zqyl-auto-subtitle {
        margin-top: 4px;
        color: #667085;
        font-size: 12px;
        line-height: 1.4;
      }
      .zqyl-auto-close {
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 8px;
        background: #eef3f6;
        color: #344054;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .zqyl-auto-close:hover {
        background: #e2ebf2;
      }
      .zqyl-auto-body {
        height: calc(100% - 72px);
        padding: 14px 16px 16px;
        box-sizing: border-box;
        overflow: auto;
      }
      .zqyl-auto-row {
        margin-top: 12px;
      }
      .zqyl-auto-label {
        display: block;
        margin-bottom: 6px;
        color: #344054;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
      }
      .zqyl-auto-help {
        margin-top: 4px;
        color: #667085;
        font-size: 12px;
        line-height: 1.45;
      }
      .zqyl-auto-input {
        width: 100%;
        height: 36px;
        box-sizing: border-box;
        border: 1px solid #d5dde7;
        border-radius: 6px;
        padding: 0 10px;
        outline: none;
        background: #fff;
        color: #172033;
        font-size: 14px;
      }
      .zqyl-auto-input:focus {
        border-color: #176b87;
        box-shadow: 0 0 0 3px rgba(23, 107, 135, 0.14);
      }
      .zqyl-auto-secret-wrap {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
      }
      .zqyl-auto-input[data-masked="true"] {
        -webkit-text-security: disc;
      }
      .zqyl-auto-secret-toggle {
        min-width: 58px;
        border: 1px solid #d5dde7;
        border-radius: 6px;
        background: #fff;
        color: #475467;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
      }
      .zqyl-auto-secret-toggle:hover {
        border-color: #176b87;
        color: #176b87;
      }
      .zqyl-auto-section {
        margin-top: 12px;
        padding: 14px;
        border: 1px solid #e7eef5;
        border-radius: 8px;
        background: #fff;
      }
      .zqyl-auto-section-title {
        color: #172033;
        font-size: 14px;
        font-weight: 700;
      }
      .zqyl-auto-tabs {
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: 8px;
        background: #eaf1f5;
      }
      .zqyl-auto-tab {
        flex: 1;
        height: 34px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #475467;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
      }
      .zqyl-auto-tab.is-active {
        background: #fff;
        color: #176b87;
        box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12);
      }
      .zqyl-auto-tab-panel[hidden] {
        display: none;
      }
      .zqyl-auto-tab-panel {
        min-height: 388px;
      }
      .zqyl-auto-switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .zqyl-auto-switch {
        position: relative;
        width: 46px;
        height: 26px;
        flex: 0 0 auto;
      }
      .zqyl-auto-switch input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .zqyl-auto-slider {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: #cbd5df;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .zqyl-auto-slider::before {
        content: "";
        position: absolute;
        width: 20px;
        height: 20px;
        left: 3px;
        top: 3px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 4px rgba(23, 32, 51, 0.25);
        transition: transform 0.2s ease;
      }
      .zqyl-auto-switch input:checked + .zqyl-auto-slider {
        background: #176b87;
      }
      .zqyl-auto-switch input:checked + .zqyl-auto-slider::before {
        transform: translateX(20px);
      }
      .zqyl-auto-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
      }
      .zqyl-auto-action {
        height: 36px;
        border: 0;
        border-radius: 6px;
        padding: 0 14px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
      }
      .zqyl-auto-primary {
        color: #fff;
        background: #176b87;
        min-width: 96px;
        box-shadow: 0 6px 16px rgba(23, 107, 135, 0.2);
      }
      .zqyl-auto-primary:hover {
        background: #11576e;
      }
      .zqyl-auto-status {
        min-height: 18px;
        margin-top: 10px;
        color: #176b87;
        font-size: 12px;
      }
    `;
        document.head.appendChild(style);
    }

    // 创建左下角脚本设置面板，并绑定保存和 tab 切换事件。
    function createSettingsPanel() {
        logStep('准备创建左下角设置面板。');
        if (document.getElementById('zqyl-auto-login-root')) {
            logStep('设置面板已存在，跳过创建。');
            return;
        }

        createStyles();

        const settings = loadSettings();
        const root = document.createElement('div');
        root.id = 'zqyl-auto-login-root';
        root.innerHTML = `
      <button id="zqyl-auto-login-button" type="button" title="打开云学堂自动化脚本设置" aria-label="打开云学堂自动化脚本设置">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" stroke="currentColor" stroke-width="2"/>
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.37a1.7 1.7 0 0 0-1 .95V20.4a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1-.95 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-.95-1H3.6a2 2 0 0 1 0-4h.08a1.7 1.7 0 0 0 .95-1 1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-.95V3.6a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1 .95 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.37 9c.2.42.53.76.95 1h.08a2 2 0 0 1 0 4h-.08a1.7 1.7 0 0 0-.92 1Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </button>
      <section id="zqyl-auto-login-panel" hidden>
        <div class="zqyl-auto-header">
          <div>
            <div class="zqyl-auto-title">云学堂自动化脚本</div>
            <div class="zqyl-auto-subtitle">适配云学堂组织站点，按页面配置自动化动作</div>
          </div>
          <button class="zqyl-auto-close" type="button" title="关闭">x</button>
        </div>
        <div class="zqyl-auto-body">
          <div class="zqyl-auto-tabs" role="tablist">
            <button class="zqyl-auto-tab is-active" type="button" data-tab="login" role="tab" aria-selected="true">登录</button>
            <button class="zqyl-auto-tab" type="button" data-tab="home" role="tab" aria-selected="false">首页</button>
            <button class="zqyl-auto-tab" type="button" data-tab="list" role="tab" aria-selected="false">课程列表</button>
            <button class="zqyl-auto-tab" type="button" data-tab="detail" role="tab" aria-selected="false">学习页</button>
          </div>
          <div class="zqyl-auto-tab-panel" data-panel="login">
            <div class="zqyl-auto-section">
              <div class="zqyl-auto-section-title">登录页自动登录</div>
              <div class="zqyl-auto-row zqyl-auto-switch-row">
                <label class="zqyl-auto-label" for="zqyl-auto-enabled">启用脚本自动化</label>
                <label class="zqyl-auto-switch">
                  <input id="zqyl-auto-enabled" type="checkbox">
                  <span class="zqyl-auto-slider"></span>
                </label>
              </div>
              <div class="zqyl-auto-help">关闭后，登录、首页跳转、课程列表查找和学习页自动学习都会停止。</div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-login-id">账号</label>
                <input id="zqyl-auto-login-id" class="zqyl-auto-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true">
                <div class="zqyl-auto-help">填写云学堂登录页使用的手机号、邮箱或账号。</div>
              </div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-login-secret">密码</label>
                <div class="zqyl-auto-secret-wrap">
                  <input id="zqyl-auto-login-secret" class="zqyl-auto-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-masked="true">
                  <button id="zqyl-auto-secret-toggle" class="zqyl-auto-secret-toggle" type="button">显示</button>
                </div>
                <div class="zqyl-auto-help">密码按要求明文保存在当前站点 localStorage。</div>
              </div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-login-step-delay">登录每步间隔</label>
                <input id="zqyl-auto-login-step-delay" class="zqyl-auto-input" type="number" min="0" step="1">
                <div class="zqyl-auto-help">单位：秒；填写账号、填写密码、勾选协议、点击登录四个动作之间都使用这个间隔。</div>
              </div>
            </div>
          </div>
          <div class="zqyl-auto-tab-panel" data-panel="home" hidden>
            <div class="zqyl-auto-section">
              <div class="zqyl-auto-section-title">首页进入课程列表</div>
              <div class="zqyl-auto-row zqyl-auto-switch-row">
                <label class="zqyl-auto-label" for="zqyl-auto-home-enabled">自动点击“查看全部”</label>
                <label class="zqyl-auto-switch">
                  <input id="zqyl-auto-home-enabled" type="checkbox">
                  <span class="zqyl-auto-slider"></span>
                </label>
              </div>
              <div class="zqyl-auto-help">登录进入首页后，在当前标签页打开在线课堂列表入口。</div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-home-delay">点击前等待时间</label>
                <input id="zqyl-auto-home-delay" class="zqyl-auto-input" type="number" min="0" step="1">
                <div class="zqyl-auto-help">单位：秒；等待首页组件加载完成后再点击，默认 5 秒。</div>
              </div>
            </div>
          </div>
          <div class="zqyl-auto-tab-panel" data-panel="list" hidden>
            <div class="zqyl-auto-section">
              <div class="zqyl-auto-section-title">课程列表自动查找</div>
              <div class="zqyl-auto-row zqyl-auto-switch-row">
                <label class="zqyl-auto-label" for="zqyl-auto-list-enabled">自动打开未学完课程</label>
                <label class="zqyl-auto-switch">
                  <input id="zqyl-auto-list-enabled" type="checkbox">
                  <span class="zqyl-auto-slider"></span>
                </label>
              </div>
              <div class="zqyl-auto-help">在 /kng/#/list 页面查找课程、视频或文档，优先打开没有“已学完”的内容。</div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-list-delay">查找前等待时间</label>
                <input id="zqyl-auto-list-delay" class="zqyl-auto-input" type="number" min="0" step="1">
                <div class="zqyl-auto-help">单位：秒；当前页都已学完时，会自动翻页继续查找。</div>
              </div>
            </div>
          </div>
          <div class="zqyl-auto-tab-panel" data-panel="detail" hidden>
            <div class="zqyl-auto-section">
              <div class="zqyl-auto-section-title">学习页自动学习</div>
              <div class="zqyl-auto-row zqyl-auto-switch-row">
                <label class="zqyl-auto-label" for="zqyl-auto-detail-enabled">启用学习页自动处理</label>
                <label class="zqyl-auto-switch">
                  <input id="zqyl-auto-detail-enabled" type="checkbox">
                  <span class="zqyl-auto-slider"></span>
                </label>
              </div>
              <div class="zqyl-auto-help">支持课程、文档、视频学习页；课程页会按左侧大纲从上往下学习未完成或部分完成项。</div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-detail-initial-delay">进入学习页后等待</label>
                <input id="zqyl-auto-detail-initial-delay" class="zqyl-auto-input" type="number" min="0" step="1">
                <div class="zqyl-auto-help">单位：秒；等待播放器、文档或课程大纲加载完成后再执行首次检查，默认 30 秒。</div>
              </div>
              <div class="zqyl-auto-row">
                <label class="zqyl-auto-label" for="zqyl-auto-detail-check-interval">学习状态检查间隔</label>
                <input id="zqyl-auto-detail-check-interval" class="zqyl-auto-input" type="number" min="1" step="1">
                <div class="zqyl-auto-help">单位：秒；用于检查完成状态、弹窗、视频暂停和课程大纲进度，默认 30 秒。</div>
              </div>
            </div>
          </div>
          <div class="zqyl-auto-actions">
            <button id="zqyl-auto-save" class="zqyl-auto-action zqyl-auto-primary" type="button">保存设置</button>
          </div>
          <div id="zqyl-auto-status" class="zqyl-auto-status" aria-live="polite"></div>
        </div>
      </section>
    `;
        document.documentElement.appendChild(root);
        logStep('左下角设置面板已创建。', safeSettingsInfo(settings));

        const panel = root.querySelector('#zqyl-auto-login-panel');
        const toggleButton = root.querySelector('#zqyl-auto-login-button');
        const closeButton = root.querySelector('.zqyl-auto-close');
        const tabButtons = Array.from(root.querySelectorAll('.zqyl-auto-tab'));
        const tabPanels = Array.from(root.querySelectorAll('.zqyl-auto-tab-panel'));
        const enabledInput = root.querySelector('#zqyl-auto-enabled');
        const usernameInput = root.querySelector('#zqyl-auto-login-id');
        const passwordInput = root.querySelector('#zqyl-auto-login-secret');
        const secretToggleButton = root.querySelector('#zqyl-auto-secret-toggle');
        const loginStepDelayInput = root.querySelector('#zqyl-auto-login-step-delay');
        const homeEnabledInput = root.querySelector('#zqyl-auto-home-enabled');
        const homeDelayInput = root.querySelector('#zqyl-auto-home-delay');
        const listEnabledInput = root.querySelector('#zqyl-auto-list-enabled');
        const listDelayInput = root.querySelector('#zqyl-auto-list-delay');
        const detailEnabledInput = root.querySelector('#zqyl-auto-detail-enabled');
        const detailInitialDelayInput = root.querySelector('#zqyl-auto-detail-initial-delay');
        const detailCheckIntervalInput = root.querySelector('#zqyl-auto-detail-check-interval');
        const saveButton = root.querySelector('#zqyl-auto-save');
        const status = root.querySelector('#zqyl-auto-status');

        enabledInput.checked = Boolean(settings.enabled);
        usernameInput.value = settings.username || '';
        passwordInput.value = settings.password || '';
        loginStepDelayInput.value = String(normalizeSeconds(settings.loginStepDelayMs, DEFAULT_SETTINGS.loginStepDelayMs));
        homeEnabledInput.checked = Boolean(settings.homeAutoViewAllEnabled);
        homeDelayInput.value = String(normalizeSeconds(settings.homeViewAllDelayMs, DEFAULT_SETTINGS.homeViewAllDelayMs));
        listEnabledInput.checked = Boolean(settings.listAutoOpenEnabled);
        listDelayInput.value = String(normalizeSeconds(settings.listActionDelayMs, DEFAULT_SETTINGS.listActionDelayMs));
        detailEnabledInput.checked = Boolean(settings.detailAutoStudyEnabled);
        detailInitialDelayInput.value = String(normalizeSeconds(settings.detailInitialDelayMs, DEFAULT_SETTINGS.detailInitialDelayMs));
        detailCheckIntervalInput.value = String(normalizeSeconds(settings.detailCheckIntervalMs, DEFAULT_SETTINGS.detailCheckIntervalMs));

        // 从设置面板读取当前输入值，并转换成脚本配置对象。
        function readPanelSettings() {
            const panelSettings = {
                enabled: enabledInput.checked,
                username: usernameInput.value.trim(),
                password: passwordInput.value,
                loginStepDelayMs: normalizeSeconds(loginStepDelayInput.value, DEFAULT_SETTINGS.loginStepDelayMs),
                homeAutoViewAllEnabled: homeEnabledInput.checked,
                homeViewAllDelayMs: normalizeSeconds(homeDelayInput.value, DEFAULT_SETTINGS.homeViewAllDelayMs),
                listAutoOpenEnabled: listEnabledInput.checked,
                listActionDelayMs: normalizeSeconds(listDelayInput.value, DEFAULT_SETTINGS.listActionDelayMs),
                detailAutoStudyEnabled: detailEnabledInput.checked,
                detailInitialDelayMs: normalizeSeconds(detailInitialDelayInput.value, DEFAULT_SETTINGS.detailInitialDelayMs),
                detailCheckIntervalMs: normalizeSeconds(detailCheckIntervalInput.value, DEFAULT_SETTINGS.detailCheckIntervalMs)
            };
            logStep('读取设置面板当前输入。', safeSettingsInfo(panelSettings));
            return panelSettings;
        }

        // 更新设置面板底部提示文字，并在短时间后自动清空。
        function setStatus(message) {
            logStep('更新设置面板状态文本。', { message });
            status.textContent = message;
            window.setTimeout(() => {
                if (status.textContent === message) status.textContent = '';
            }, 2500);
        }

        // 打开或关闭左下角设置面板。
        function togglePanel(force) {
            state.panelOpen = typeof force === 'boolean' ? force : !state.panelOpen;
            panel.hidden = !state.panelOpen;
            logStep(state.panelOpen ? '打开设置面板。' : '关闭设置面板。');
        }

        // 切换设置面板中的 tab 页。
        function activateTab(tabName) {
            logStep('切换设置面板 tab。', { tabName });
            tabButtons.forEach((button) => {
                const active = button.dataset.tab === tabName;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            tabPanels.forEach((tabPanel) => {
                tabPanel.hidden = tabPanel.dataset.panel !== tabName;
            });
        }

        toggleButton.addEventListener('click', () => togglePanel());
        closeButton.addEventListener('click', () => togglePanel(false));
        tabButtons.forEach((button) => {
            button.addEventListener('click', () => activateTab(button.dataset.tab));
        });
        secretToggleButton.addEventListener('click', () => {
            const masked = passwordInput.dataset.masked !== 'false';
            passwordInput.dataset.masked = masked ? 'false' : 'true';
            secretToggleButton.textContent = masked ? '隐藏' : '显示';
        });
        saveButton.addEventListener('click', () => {
            logStep('用户点击保存按钮。');
            saveSettings(readPanelSettings());
            setStatus('已保存到本地浏览器。');
            state.loginTried = false;
            state.loginFlowStarted = false;
            state.listActionScheduled = false;
            state.listItemClicked = false;
            state.listPageTurning = false;
            resetLearningDetailState('保存设置后');
            logStep('保存后重置登录尝试状态。');
            runAutomationChecks('保存设置后');
        });
    }

    // 判断 DOM 变化是否需要触发自动化检查，详情页不响应 DOM 变化，避免播放页重复检查。
    function shouldCheckForDomChange() {
        return !isLearningDetailPage() && (isLoginPage() || isHomeIndexPage() || isTargetListPage() || isLearningScanPage());
    }

    // 脚本启动入口：页面 load 完成后创建设置面板并注册 URL/DOM 变化后的检查。
    function boot() {
        logStep('脚本启动。', { href: location.href, readyState: document.readyState });
        createSettingsPanel();
        logStep('注册 DOM 变化监听。');
        const debouncedDomCheck = debounce(() => runAutomationChecks('页面变化'), 400);
        const observer = new MutationObserver(() => {
            if (shouldCheckForDomChange()) debouncedDomCheck();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('hashchange', () => {
            logStep('检测到 hash 路由变化。', { href: location.href });
            if (isLoginPage()) {
                clearScanTransitionTimer('进入登录页');
            }
            if (isHomeIndexPage()) {
                clearScanTransitionTimer('进入首页');
                state.homeViewAllScheduled = false;
                state.homeViewAllClicked = false;
                logStep('进入首页，重置首页点击“查看全部”状态。');
            }
            if (isTargetListPage()) {
                clearScanTransitionTimer('进入在线课堂列表页');
                state.listActionScheduled = false;
                state.listItemClicked = false;
                state.listPageTurning = false;
                resetLearningDetailState('进入列表页');
                logStep('进入在线课堂列表页，重置未学完内容查找状态。');
            }
            if (isLearningScanPage()) {
                resetLearningDetailState('进入资源扫描中转页');
                logStep('进入资源扫描中转页，等待站点跳转到真实学习详情页。');
            }
            if (isLearningDetailPage()) {
                clearScanTransitionTimer('进入学习详情页');
                resetLearningDetailState('进入学习详情页');
            } else {
                window.clearTimeout(state.detailInitialTimer);
                window.clearInterval(state.detailCheckTimer);
            }
            if (!isLoginPage() && !isHomeIndexPage() && !isTargetListPage() && !isLearningScanPage() && !isLearningDetailPage()) {
                clearScanTransitionTimer('进入非自动化页面');
            }
            runAutomationChecks('hash 路由变化');
        });
        logStep('页面加载完成，执行首次自动化检查。');
        runAutomationChecks('页面 load 完成');
    }

    // 等待 window load 事件，确保页面资源和初始脚本加载完成后再运行本脚本逻辑。
    function bootAfterWindowLoad() {
        if (document.readyState === 'complete') {
            logStep('页面已完成加载，立即启动脚本。', { readyState: document.readyState });
            boot();
            return;
        }
        logStep('页面尚未完成加载，等待 window load 后启动。', { readyState: document.readyState });
        window.addEventListener('load', boot, { once: true });
    }

    bootAfterWindowLoad();
})();
