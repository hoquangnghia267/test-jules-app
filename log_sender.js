const fs = require('fs');
const readline = require('readline');
const axios = require('axios');

const LOG_FILE = 'server.log';
const API_URL = 'http://10.0.0.8:9428/insert/jsonline';
const API_HEADERS = {
    'Content-Type': 'application/x-ndjson',
    'Authorization': 'Basic bG9nd3JpdGVyOmk3TWRNdUJ2U2pQRzdraGdXU2pFdkZvYnJzc3RHeQ=='
};

// Regex to parse the main log structure:
// Date Time Level [Class] (Thread) IP:[IP] Message
const LOG_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(\w+)\s+\[(.*?)\]\s+\((.*?)\)\s+IP:\[(.*?)\]\s+(.*)$/;

async function processLine(line) {
    const match = line.match(LOG_REGEX);
    if (!match) {
        // Line doesn't match the expected format, skipping or could handle partials
        // console.warn('Skipping unmatched line:', line);
        return null;
    }

    const [_, timestampStr, level, className, thread, ip, message] = match;

    // Parse timestamp to Unix timestamp (seconds)
    // Timestamp format in log: 2026-01-15 10:50:06,834
    // Replace comma with dot for JS Date parsing compatibility if needed, though most parses handle it.
    // However, JS Date uses milliseconds. The API example "1768444133" suggests seconds.
    const timeMillis = new Date(timestampStr.replace(',', '.')).getTime();
    const timeSeconds = Math.floor(timeMillis / 1000).toString();

    // Parse Key-Value pairs in the message (if any)
    // Example: logType=4 userCode= tokenCode=12957 ...
    const kv = {};
    const kvRegex = /(\w+)=([^\s]*)/g;
    let kvMatch;
    while ((kvMatch = kvRegex.exec(message)) !== null) {
        kv[kvMatch[1]] = kvMatch[2];
    }

    // Construct Payload
    // Requirements:
    // _time: unix timestamp (string?)
    // _msg: message content
    // username: from userCode or default
    // ip: from log
    // domain: from domainCode or default 'test.smartsign.com.vn'
    // mirror: '0'
    // action: from actionCode or 'log' or derived from level
    // status: 'success' (maybe if INFO?), or use Level (WARN/INFO)
    // user_agent: default
    // location: default

    // Logic for Action/Status mappings based on log content
    let action = kv.actionCode || 'log';
    let status = 'success'; // Defaulting to success, could map WARN to 'warning' or 'failed'
    if (level === 'WARN') status = 'warning';
    if (level === 'ERROR') status = 'error';

    const payload = {
        "_time": timeSeconds,
        "_msg": message, // Using the full message part as the message
        "username": kv.userCode || "",
        "ip": ip,
        "domain": "test.smartsign.com.vn", // Defaulting as per curl example context, could map kv.domainCode if strictly numeric
        "mirror": "0",
        "action": action,
        "status": status,
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0", // Hardcoded from example
        "location": "HCMC" // Hardcoded from example
    };

    return payload;
}

async function sendLog(payload) {
    try {
        // For verification in environments where the IP is not reachable:
        console.log('Preparing to send payload:', JSON.stringify(payload));

        await axios.post(API_URL, payload, {
            headers: API_HEADERS,
            timeout: 1000 // Short timeout for testing purposes
        });
        console.log('Successfully sent log.');
    } catch (error) {
        console.error(`Failed to send log: ${error.message}`);
        // If it's a connection error (expected in sandbox), just note it.
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
            console.log('(Network error expected in test environment)');
        }
    }
}

async function main() {
    if (!fs.existsSync(LOG_FILE)) {
        console.error(`File ${LOG_FILE} not found.`);
        return;
    }

    const fileStream = fs.createReadStream(LOG_FILE);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const payload = await processLine(line);
        if (payload) {
            await sendLog(payload);
        }
    }
}

main().catch(console.error);
