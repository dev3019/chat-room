import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import {V4Options, v4} from 'uuid';
import {clientRds} from './redis';
const app = express()
let count=0
app.get('/', function(req, res){
  console.log(`Received request for ${req.url}`)
  res.json('hi there')
})

const httpServer = app.listen(3001, function() {
  console.log((new Date()) + ' Server is listening on port 8080');
})

const wss = new WebSocketServer({server: httpServer})
const clients = new Map(); // Map to store WebSocket clients and their unique identifiers

wss.on('connection', async function connection(ws){
  try{
    const id = v4(); // Assign a unique identifier to the WebSocket client
    clients.set(ws, id)
    ws.on('error', console.error)
    
    ws.on('message', async function message(data, isBinary){
      wss.clients.forEach(function each(client){  // send same message to all users
        if(client !== ws && client.readyState === WebSocket.OPEN){
          // Include sender information in the message payload
          const senderInfo = {
            clientId: clients.get(ws), // Get the client's identifier from the map
            message: data.toString() // Convert the message buffer to string if it's not already
          };
          client.send(JSON.stringify(senderInfo), { binary: isBinary });
        }
      })
    })

    ws.send(JSON.stringify({
      message: 'Hello! Message from server2!',
    }))
  } catch(error){
    console.error(error)
  }
})