const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.json');
const LOOP_FILE = path.join(DATA_DIR, 'loop.json');
const REPLAY_FILE = path.join(DATA_DIR, 'replay.txt');

const DISCORD_REPLAY_WEBHOOK = 'https://discord.com/api/webhooks/1467283931526332654/ka_L-jSiEm6bwaY3LsrJaF8wf1ZSexok2DuqtK39G8w_Cb7oSDFjHPUN61zUnS4iiJot';
const DISCORD_ACCOUNT_WEBHOOK = 'https://discord.com/api/webhooks/1467286140808593522/s6Kye5OzqnVxyIGQPi9oHjzE1gRLi9EROff53Ugcc9hYeCADUgO7C5Yz1T1HiVNglpoL';
const TARGET_ACCOUNT = 'b5mTR';

const INDIAN_CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune',
  'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore',
  'Bhopal', 'Vadodara', 'Patna', 'Ranchi', 'Raipur', 'Guwahati',
  'Amritsar', 'Ludhiana', 'Jalandhar', 'Chandigarh', 'Gurgaon', 'Noida',
  'Ghaziabad', 'Faridabad', 'Meerut', 'Agra', 'Mathura', 'Aligarh',
  'Bareilly', 'Moradabad', 'Prayagraj', 'Varanasi', 'Gorakhpur',
  'Jabalpur', 'Gwalior', 'Ujjain', 'Ratlam', 'Aurangabad',
  'Nashik', 'Thane', 'Panaji', 'Margao', 'Mangaluru',
  'Udupi', 'Hubballi', 'Belagavi', 'Madurai', 'Salem',
  'Erode', 'Thanjavur', 'Tiruppur', 'Vellore', 'Nellore',
  'Vijayawada', 'Guntur', 'Warangal', 'Nizamabad', 'Karimnagar',
  'Kakinada', 'Rajahmundry', 'Visakhapatnam', 'Cuttack', 'Rourkela',
  'Durgapur', 'Asansol', 'Howrah', 'Siliguri', 'Agartala',
  'Imphal', 'Aizawl'
];

const MAX_RETRIES = 3;
const NAVIGATION_TIMEOUT = 30000;
const CONNECTION_CHECK_INTERVAL = 5000; // Check connection every 5 seconds

let browser = null;
let page = null;
let botState = {
  running: false,
  currentStep: 'idle',
  stepTimer: 0,
  currentLoop: 0,
  totalLoops: 20,
  account: loadData(ACCOUNT_FILE, null),
  previewEnabled: false,
  lastScreenshot: null,
  errorCount: 0,
  lastError: null,
  connectionIssues: 0
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomCity() {
  return INDIAN_CITIES[Math.floor(Math.random() * INDIAN_CITIES.length)];
}

function loadData(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.trim()) return JSON.parse(content);
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e.message);
  }
  return defaultVal;
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error saving ${file}:`, e.message);
  }
}

function updateState(updates) {
  Object.assign(botState, updates);
}

function getState() {
  return botState;
}

function logError(error, context) {
  const errorMsg = `[${context}] ${error.message}`;
  console.error(errorMsg);
  botState.errorCount++;
  botState.lastError = {
    message: error.message,
    context,
    timestamp: new Date().toISOString()
  };
}

// NEW: Check if error is connection-related
function isConnectionError(error) {
  const connectionErrors = [
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_RESET',
    'ERR_NETWORK_CHANGED',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_ADDRESS_UNREACHABLE',
    'net::ERR_',
    'Protocol error',
    'Target closed',
    'Session closed',
    'Navigation timeout',
    'timeout',
    'unreachable',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'closed',
    'disconnected'
  ];
  
  const errorString = error.toString().toLowerCase();
  return connectionErrors.some(errType => 
    errorString.includes(errType.toLowerCase())
  );
}

// NEW: Enhanced page health check
async function checkPageHealth() {
  if (!page || page.isClosed()) {
    return false;
  }
  
  try {
    // Try to evaluate a simple expression
    await page.evaluate(() => true);
    return true;
  } catch (error) {
    console.log('Page health check failed:', error.message);
    return false;
  }
}

// NEW: Auto-refresh on connection issues
async function handleConnectionError(error, context, currentUrl = null) {
  console.log(`Connection error detected in ${context}: ${error.message}`);
  botState.connectionIssues++;
  
  // Try to refresh the page
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Attempting to recover connection (attempt ${attempt}/3)...`);
      
      // Check if page still exists
      const isHealthy = await checkPageHealth();
      
      if (!isHealthy) {
        console.log('Page is unhealthy, recreating browser...');
        await ensureBrowser();
        if (currentUrl) {
          await safeGoto(currentUrl, 1);
        }
        return true;
      }
      
      // Try to reload the page
      await page.reload({ 
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT 
      });
      
      console.log('Connection recovered successfully');
      botState.connectionIssues = 0;
      return true;
      
    } catch (retryError) {
      console.log(`Recovery attempt ${attempt} failed:`, retryError.message);
      
      if (attempt === 3) {
        console.log('All recovery attempts failed, recreating browser...');
        await ensureBrowser();
        if (currentUrl) {
          await safeGoto(currentUrl, 1);
        }
        return false;
      }
      
      await delay(3000 * attempt);
    }
  }
  
  return false;
}

async function takeScreenshot() {
  if (!page || !botState.previewEnabled) return null;
  try {
    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
    botState.lastScreenshot = screenshot;
    return screenshot;
  } catch (e) {
    return null;
  }
}

async function sendToDiscord(webhookUrl, content, options = {}) {
  const { isFile = false, filename = 'file.txt', message = '' } = options;
  try {
    if (isFile) {
      const formData = new FormData();
      formData.append('file', new Blob([content]), filename);
      if (message) formData.append('payload_json', JSON.stringify({ content: message }));
      await fetch(webhookUrl, { method: 'POST', body: formData});
    } else {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    }
  } catch (e) {
    console.error('Discord send error:', e.message);
  }
}

// UPGRADED: Safe navigation with connection error handling
async function safeGoto(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT 
      });
      botState.connectionIssues = 0; // Reset on success
      return true;
    } catch (error) {
      logError(error, `Navigation to ${url} - Attempt ${attempt}/${retries}`);
      
      // Check if it's a connection error
      if (isConnectionError(error)) {
        console.log('Connection error detected during navigation');
        await handleConnectionError(error, 'safeGoto', url);
        
        // If not last attempt, try again
        if (attempt < retries) {
          await delay(5000);
          continue;
        }
      }
      
      if (attempt === retries) {
        console.log(`Failed to navigate after ${retries} attempts, will retry with fresh browser...`);
        await ensureBrowser();
        // One final attempt with new browser
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT 
          });
          return true;
        } catch (finalError) {
          console.log('Final navigation attempt failed');
          return false;
        }
      }
      
      await delay(3000 * attempt);
    }
  }
  return false;
}

// UPGRADED: Safe reload with connection error handling
async function safeReload(retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // First check if page is healthy
      const isHealthy = await checkPageHealth();
      if (!isHealthy) {
        console.log('Page unhealthy before reload, recreating browser...');
        await ensureBrowser();
        return false;
      }
      
      await page.reload({ 
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT 
      });
      botState.connectionIssues = 0; // Reset on success
      return true;
    } catch (error) {
      logError(error, `Reload - Attempt ${attempt}/${retries}`);
      
      // Check if it's a connection error
      if (isConnectionError(error)) {
        console.log('Connection error detected during reload');
        const currentUrl = await page.url().catch(() => 'https://territorial.io');
        await handleConnectionError(error, 'safeReload', currentUrl);
        
        if (attempt < retries) {
          await delay(3000);
          continue;
        }
      }
      
      if (attempt === retries) {
        console.log(`Failed to reload after ${retries} attempts, recreating browser...`);
        await ensureBrowser();
        return false;
      }
      
      await delay(2000 * attempt);
    }
  }
  return false;
}

// UPGRADED: Safe click with connection error handling
async function safeClick(x, y, description = 'click') {
  try {
    // Check page health before clicking
    const isHealthy = await checkPageHealth();
    if (!isHealthy) {
      console.log('Page unhealthy before click, skipping...');
      return false;
    }
    
    await page.mouse.click(x, y);
    return true;
  } catch (error) {
    logError(error, `Click at (${x}, ${y}) - ${description}`);
    
    if (isConnectionError(error)) {
      console.log('Connection error during click');
      const currentUrl = await page.url().catch(() => 'https://territorial.io');
      await handleConnectionError(error, 'safeClick', currentUrl);
    }
    
    return false;
  }
}

// UPGRADED: Safe evaluate with connection error handling
async function safeEvaluate(fn, ...args) {
  try {
    return await page.evaluate(fn, ...args);
  } catch (error) {
    logError(error, 'Page evaluate');
    
    if (isConnectionError(error)) {
      console.log('Connection error during evaluate');
      const currentUrl = await page.url().catch(() => 'https://territorial.io');
      await handleConnectionError(error, 'safeEvaluate', currentUrl);
    }
    
    return null;
  }
}

async function createAccount() {
  updateState({ currentStep: 'Creating account...' });

  try {
    await page.setViewport({ width: 800, height: 600 });
    await safeGoto('https://territorial.io');
    await delay(1000);
    await safeReload();
    await delay(2000);

    await safeClick(347, 363, 'Account button');
    await delay(2000);
    await safeClick(593, 575, 'Create account');
    await delay(1000);

    await safeReload();
    await delay(1000);
    await safeReload();
    await delay(2000);

    await page.waitForFunction(() => {
      try {
        return typeof localStorage !== 'undefined' &&
               localStorage.getItem !== undefined &&
               window.location.origin.startsWith('https://territorial.io');
      } catch {
        return false;
      }
    }, { timeout: 10000 }).catch(() => {
      console.log('WaitForFunction timeout, continuing...');
    });

    const credentials = await safeEvaluate(() => ({
      d105: localStorage.getItem('d105'),
      d106: localStorage.getItem('d106')
    }));

    if (credentials && credentials.d105) {
      saveData(ACCOUNT_FILE, credentials);
      botState.account = credentials;
      console.log('Account created:', credentials.d105);
      return credentials;
    } else {
      throw new Error('Failed to retrieve credentials from localStorage');
    }
  } catch (error) {
    logError(error, 'createAccount');
    throw error;
  }
}

async function runLoop(loopNum) {
  updateState({ currentLoop: loopNum, currentStep: `Loop ${loopNum}/20 - Starting` });
  saveData(LOOP_FILE, { currentLoop: loopNum, startedAt: new Date().toISOString() });

  try {
    // Step 1: Visit website
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 1: Visiting website`, stepTimer: 5 });
    await safeGoto('https://territorial.io');
    await delay(5000);

    // Step 2: Refresh
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 2: Refreshing`, stepTimer: 1 });
    await safeReload();
    await delay(1000);

    // Step 3: Set localStorage
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 3: Setting localStorage` });
    const account = loadData(ACCOUNT_FILE, {});
    const cityName = getRandomCity();
    await safeEvaluate((acc, city) => {
      if (acc.d105) localStorage.setItem('d105', acc.d105);
      if (acc.d106) localStorage.setItem('d106', acc.d106);
      localStorage.setItem('d122', `[IND] ${city}`);
    }, account, cityName);
    
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 3.5: Refreshing to apply settings` });
    await safeReload();
    await delay(2000);

    // Step 4: Click Multiplayer
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 4: Clicking Multiplayer`, stepTimer: 5 });
    await safeClick(349, 297, 'Multiplayer');
    await delay(5000);

    // Step 5: Click Team Mode
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 5: Clicking Team Mode`, stepTimer: 2 });
    await safeClick(84, 55, 'Team Mode');
    await delay(2000);

    // Step 6: Click Ready
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 6: Clicking Ready`, stepTimer: 60 });
    await safeClick(590, 566, 'Ready');
    await delay(60000);

    // Step 7: Playing (WITH CONNECTION MONITORING)
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 7: Playing (8 minutes)`, stepTimer: 480 });
    const playEndTime = Date.now() + 480000;
    let lastSpace = Date.now();
    let lastScroll = Date.now();
    let lastHealthCheck = Date.now();

    while (Date.now() < playEndTime && botState.running) {
      try {
        // Periodic health check during long play session
        if (Date.now() - lastHealthCheck >= CONNECTION_CHECK_INTERVAL) {
          const isHealthy = await checkPageHealth();
          if (!isHealthy) {
            console.log('Connection lost during play, attempting recovery...');
            await handleConnectionError(
              new Error('Connection lost during gameplay'), 
              'playing', 
              'https://territorial.io'
            );
            // Break and retry this loop
            throw new Error('Connection lost during gameplay');
          }
          lastHealthCheck = Date.now();
        }
        
        const x = 100 + Math.random() * 600;
        const y = 50 + Math.random() * 250;
        await page.mouse.move(x, y, { steps: 10 });

        if (Date.now() - lastSpace >= 4000) {
          await page.keyboard.press('Space');
          lastSpace = Date.now();
        }
        if (Date.now() - lastScroll >= 10000) {
          await page.mouse.wheel({ deltaY: 100 });
          lastScroll = Date.now();
        }
        await delay(500);
        botState.stepTimer = Math.ceil((playEndTime - Date.now()) / 1000);
      } catch (error) {
        logError(error, 'Playing loop');
        
        // If connection error, try to recover
        if (isConnectionError(error)) {
          console.log('Connection error during gameplay, breaking loop...');
          throw error;
        }
        
        // Continue playing for other errors
      }
    }

    // Steps 8-11: Menu navigation
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 8: Menu`, stepTimer: 1 });
    await safeClick(18, 579, 'Menu');
    await delay(1000);

    updateState({ currentStep: `Loop ${loopNum}/20 - Step 9: Exit`, stepTimer: 5 });
    await safeClick(18, 579, 'Exit');
    await delay(5000);

    updateState({ currentStep: `Loop ${loopNum}/20 - Step 10: Close`, stepTimer: 3 });
    await safeClick(18, 579, 'Close');
    await delay(3000);

    updateState({ currentStep: `Loop ${loopNum}/20 - Step 11: Home`, stepTimer: 1 });
    await safeClick(18, 579, 'Home');
    await delay(1000);

    // Step 12: Settings
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 12: Settings`, stepTimer: 5 });
    await safeClick(449, 363, 'Settings');
    await delay(5000);

    // Step 13: Replay
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 13: Replay`, stepTimer: 2 });
    await safeClick(711, 113, 'Replay');
    await delay(2000);

    // Step 14: Copy replay
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 14: Copying replay` });
    await safeClick(398, 303, 'Replay text area');
    await delay(1000);
    
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await delay(500);

      const replayText = await safeEvaluate(() => {
        const sel = window.getSelection();
        return sel ? sel.toString() : '';
      });

      if (replayText) {
        fs.writeFileSync(REPLAY_FILE, replayText);
        await sendToDiscord(DISCORD_REPLAY_WEBHOOK, replayText, {
          isFile: true,
          filename: 'replay.txt',
          message: `Replay for loop ${loopNum}`
        });
        fs.writeFileSync(REPLAY_FILE, '');
      }
    } catch (error) {
      logError(error, 'Copy replay');
    }

    // Step 15: Final refresh
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 15: Refreshing` });
    await safeReload();
    await delay(1000);
    await safeReload();

    // Step 16: Delay
    updateState({ currentStep: `Loop ${loopNum}/20 - Step 16: Delay`, stepTimer: 10 });
    await delay(10000);

    saveData(LOOP_FILE, { currentLoop: loopNum, completedAt: new Date().toISOString() });
    
  } catch (error) {
    logError(error, `runLoop ${loopNum}`);
    // Save progress even on error
    saveData(LOOP_FILE, { 
      currentLoop: loopNum, 
      errorAt: new Date().toISOString(),
      error: error.message 
    });
    throw error;
  }
}

async function getGoldAndSend() {
  updateState({ currentStep: 'Getting gold balance...' });
  const account = loadData(ACCOUNT_FILE, {});

  try {
    const response = await fetch('https://territorial.io/api/account/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_name: account.d105,
        password: account.d106,
        target_account_name: account.d105
      })
    });
    const data = await response.json();
    console.log('Account data:', data);

    if (data.status === 'ok' && data.account_data) {
      let goldCents = data.account_data.gold_cents || 0;
      let amount = Math.floor(goldCents / 100) - 1;

      if (amount > 0) {
        updateState({ currentStep: `Sending ${amount} gold to ${TARGET_ACCOUNT}...` });
        let success = false;

        while (!success && amount > 0) {
          const sendResponse = await fetch('https://territorial.io/api/gold/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_name: account.d105,
              password: account.d106,
              target_account_name: TARGET_ACCOUNT,
              amount: amount
            })
          });
          const sendData = await sendResponse.json();
          console.log('Send gold response:', sendData);

          if (sendData.status === 'ok') {
            success = true;
          } else {
            amount--;
            await delay(30000);
          }
        }
      }
    }
  } catch (e) {
    logError(e, 'Gold API');
  }

  await delay(10000);

  try {
    updateState({ currentStep: 'Sending account to Discord...' });
    const accountContent = fs.readFileSync(ACCOUNT_FILE, 'utf8');
    await sendToDiscord(DISCORD_ACCOUNT_WEBHOOK, accountContent, {
      isFile: true,
      filename: 'account.json'
    });
  } catch (e) {
    logError(e, 'Send account to Discord');
  }

  await delay(5000);

  saveData(ACCOUNT_FILE, {});
  saveData(LOOP_FILE, { currentLoop: 0 });

  if (page) {
    try {
      updateState({ currentStep: 'Clearing browser storage...' });
      await safeEvaluate(() => localStorage.clear());
      await safeReload();
      await delay(2000);
    } catch (e) {
      logError(e, 'Clear storage');
    }
  }
}

async function ensureBrowser() {
  if (!browser || !page || page.isClosed()) {
    console.log('Recreating browser instance...');
    
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.log('Error closing old browser:', e.message);
      }
    }

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-web-security', 
        '--allow-running-insecure-content'
      ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    
    // Set longer default timeout
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    
    // NEW: Add error listener for connection issues
    page.on('error', async (error) => {
      console.log('Page error event:', error.message);
      if (isConnectionError(error)) {
        await handleConnectionError(error, 'page error event');
      }
    });
    
    page.on('close', () => {
      console.log('Page closed unexpectedly');
    });
  }
}

async function startBot() {
  if (botState.running) return;

  updateState({ running: true, currentStep: 'Starting browser...', errorCount: 0, connectionIssues: 0 });

  try {
    await ensureBrowser();

    while (botState.running) {
      try {
        const loopData = loadData(LOOP_FILE, { currentLoop: 0 });
        let startLoop = loopData.currentLoop || 0;

        if (startLoop === 0 || !botState.account || !botState.account.d105) {
          try {
            await createAccount();
            startLoop = 1;
          } catch (error) {
            logError(error, 'Account creation failed');
            
            if (isConnectionError(error)) {
              updateState({ currentStep: 'Connection error during account creation, retrying in 15s...' });
              await delay(15000);
            } else {
              updateState({ currentStep: 'Retrying account creation in 10s...' });
              await delay(10000);
            }
            
            await ensureBrowser();
            continue;
          }
        }

        for (let i = startLoop; i <= 20 && botState.running; i++) {
          try {
            await ensureBrowser();
            await runLoop(i);
            
            // Reset error counters on success
            botState.errorCount = 0;
            botState.connectionIssues = 0;
            
          } catch (error) {
            logError(error, `Loop ${i} failed`);
            
            if (isConnectionError(error)) {
              updateState({ currentStep: `Connection error in loop ${i}, recovering...` });
              await delay(10000);
              await ensureBrowser();
              i--; // Retry same loop
            } else {
              updateState({ currentStep: `Loop ${i} error, retrying in 15s...` });
              await delay(15000);
              await ensureBrowser();
              i--; // Retry same loop
            }
            
            // If we've had too many consecutive errors, skip this loop
            if (botState.errorCount > 10) {
              console.log('Too many errors, skipping to next loop');
              botState.errorCount = 0;
            }
          }
        }

        if (botState.running) {
          try {
            await getGoldAndSend();
          } catch (error) {
            logError(error, 'getGoldAndSend');
          }
        }
        
      } catch (error) {
        logError(error, 'Main loop');
        
        if (isConnectionError(error)) {
          updateState({ currentStep: 'Connection error in main loop, restarting in 20s...' });
          await delay(20000);
        } else {
          updateState({ currentStep: 'Critical error, restarting in 30s...' });
          await delay(30000);
        }
        
        await ensureBrowser();
      }
    }
  } catch (error) {
    logError(error, 'startBot');
    botState.running = false;
    updateState({ currentStep: 'Bot stopped due to critical error' });
  }
}

(async () => {
  try {
    console.log('Auto-starting bot...');
    await startBot();
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
})();
module.exports = {
  getState,
  startBot,
  
 
  togglePreview,
  takeScreenshot
};

function togglePreview(enabled) {
  updateState({ previewEnabled: enabled });
}
