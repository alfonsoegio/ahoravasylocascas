require('dotenv').config()

const FS = require('fs')
const AXIOS = require('axios')
const EXEC = require('child_process').exec
const WEBSOCKET_CLIENT = require('websocket').client
const PARTICIPANTS = JSON.parse(FS.readFileSync(process.env.PARTICIPANTS))

const CLIENT = new WEBSOCKET_CLIENT()
const AI_INPUT = {}

const waitForCondition = async function (message, lmessage, ms, condition) {
  return new Promise(resolve => {
    const interval = setInterval(async () => {
      if (await condition(interval)) {
        clearInterval(interval)
        resolve(lmessage)
      }
    }, ms)
  })
}

function populateAIInput () {
  Object.keys(PARTICIPANTS).map((x) => {
    AI_INPUT[x] = {
      voice: PARTICIPANTS[x].voice,
      prompt: FS.readFileSync(PARTICIPANTS[x].prompt).toString(),
      ai_input: []
    }
  })
}

const waitForUnlock = async function () {
  const lockFilename = '.lock'
  return waitForCondition(
    'Waiting for pending txs',
    'Audio client unlocked',
    1000,
    () => {
      return !FS.existsSync(lockFilename)
    })
}

async function callGemini (participant) {
  if (FS.existsSync('./.lock')) {
    await waitForUnlock()
  }
  FS.closeSync(FS.openSync('./.lock', 'w'))
  const uri = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`
  const parts = AI_INPUT[participant].ai_input.map(function (x) {return {text: x}})
  const body = {
    contents:
    [ { parts: parts } ]
  }
  const geminiResponse = await AXIOS.post(uri,  body)
  const text = geminiResponse.data.candidates[0].content.parts[0].text.replace(/\*/gi, '')
  const soundFilename = `sound/${new Date().getTime()}.wav`
  console.log(soundFilename)
  AI_INPUT[participant].ai_input.push(text)
  const child = await EXEC(`echo "${text}" | ./piper --model ${PARTICIPANTS[participant].voice} --output-file ${soundFilename} && cat ${soundFilename} $ |aplay`)
  child.on('exit', async function () {
    if (FS.existsSync('./.lock')) {
      FS.unlinkSync('./.lock')
    }
  })
}

async function initParticipants () {
  for (const [key, value] of Object.entries(PARTICIPANTS)) {
    console.log(`Key: ${key}, Value: ${value}`);
    console.log(AI_INPUT[key].prompt)
    await processChatMessage(AI_INPUT[key].prompt, key)
  }
}

async function processChatMessage (message, participant) {
  if (FS.existsSync('./.lock')) {
    await waitForUnlock()
  }
  FS.closeSync(FS.openSync('./.lock', 'w'))
  const uri = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`
  AI_INPUT[participant].ai_input.push(message)
  const parts = AI_INPUT[participant].ai_input.map(function (x) {return {text: x}})
  const body = {
    contents:
    [ { parts: parts } ]
  }
  const geminiResponse = await AXIOS.post(uri,  body)
  const text = geminiResponse.data.candidates[0].content.parts[0].text.replace(/\*/gi, '')
  console.log(`${participant}: ${text}\n\n`)
  AI_INPUT[participant].ai_input.push(message)
  AI_INPUT[participant].ai_input.push(text)
  const soundFilename = `sound/${new Date().getTime()}.wav`
  const voice = AI_INPUT[participant].voice
  const child = await EXEC(`echo "${text}" | ./piper --model ${voice} --output-file ${soundFilename} && cat ${soundFilename} $ |aplay`)
  child.on('exit', async function () {
    if (FS.existsSync('./.lock')) {
      FS.unlinkSync('./.lock')
    }
  })
}

async function processMessage (message) {
  const messageObject = JSON.parse(message.utf8Data)
  if (!messageObject.commit || !messageObject.commit.record) {
    return
  }
  if (process.env.BS_LANGUAGE) {
    if (!messageObject.commit.record.langs || !messageObject.commit.record.langs.includes(process.env.BS_LANGUAGE)) {
      return
    }
  }
  const re = new RegExp(String.raw`${process.env.KEYWORD}`, "gi");
  if (process.env.KEYWORD && !messageObject.commit.record.text.match(re)) {
    return
  }
  const keys = Object.keys(PARTICIPANTS)
  const participant = keys[Math.floor(Math.random() * keys.length)]
  const text = messageObject.commit.record.text.trim().replace(/(\r\n|\n|\r)/gm, '')
  console.log(`Para ${participant}: ${text}`)
  AI_INPUT[participant].ai_input.push(`**${text}**`)
  await callGemini(participant)
}

async function main () {
  populateAIInput()
  await initParticipants()
  // return
  // const prompt = FS.readFileSync('prompt.txt').toString()
  // AI_INPUT.push(prompt)
  // await callGemini()
  CLIENT.connect(process.env.SOCKET)
  CLIENT.on('connectFailed', function(error) {
    console.log('Connect Error: ' + error.toString())
  })
  CLIENT.on('connect', function(connection) {
    connection.on('error', function(error) {
      console.log("Connection Error: " + error.toString())
    })
    connection.on('close', function() {
      console.log('echo-protocol Connection Closed')
    })
    connection.on('message', async function(message) {
      if (message.type === 'utf8') {
        await processMessage(message)
      }
    })
  })
  await setTimeout(() => console.log('Finishing'), 10000000)
}

main()
