require('dotenv').config()

const FS = require('fs')
const AXIOS = require('axios')
const EXEC = require('child_process').exec
const WEBSOCKET_CLIENT = require('websocket').client

const CLIENT = new WEBSOCKET_CLIENT()
const AI_INPUT = []

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

async function callGemini () {
  if (FS.existsSync('./.lock')) {
    await waitForUnlock()
  }
  FS.closeSync(FS.openSync('./.lock', 'w'))
  const uri = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`
  const parts = AI_INPUT.map(function (x) {return {text: x}})
  const body = {
    contents:
    [ { parts: parts } ]
  }
  const geminiResponse = await AXIOS.post(uri,  body)
  const text = geminiResponse.data.candidates[0].content.parts[0].text.replace(/\*/gi, '')
  const soundFilename = `sound/${new Date().getTime()}.wav`
  console.log(soundFilename)
  const child = await EXEC(`echo "${text}" | ./piper --model ${process.env.VOICE} --output-file ${soundFilename} && cat ${soundFilename} $ |aplay`)
  child.on('exit', async function () {
    console.log(AI_INPUT)
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
  if (process.env.LANGUAGE) {
    if (!messageObject.commit.record.langs || !messageObject.commit.record.langs.includes(process.env.LANGUAGE)) {
      return
    }
  }
  const re = new RegExp(String.raw`${process.env.KEYWORD}`, "gi");
  if (process.env.KEYWORD && !messageObject.commit.record.text.match(re)) {
    return
  }
  const text = messageObject.commit.record.text.trim().replace(/(\r\n|\n|\r)/gm, '')
  console.log(text)
  AI_INPUT.push(`**${text}**`)
  await callGemini()
}

async function main () {
  const prompt = FS.readFileSync('prompt.txt').toString()
  AI_INPUT.push(prompt)
  await callGemini()
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
