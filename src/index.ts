import express, { Request, Response } from "express";
import http from "http";
import WebSocket, { Server as WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { redisInstance } from "./PubSubManager";

const app = express();
app.use(express.json({ limit: "30mb" }));
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// API endpoint to create a new WebSocket server
app.post("/servers", async (req: Request, res: Response) => {
  try {
    let { country } = req.body;
    if (!country) {
      return res.status(400).json({ error: "Required parameters missing." });
    }
    country = country.toLowerCase();
    const chatRooms = await redisInstance.getAllWebSocketServers()
    if (chatRooms.length >= 50) {
      return res.status(429).json({ error: "Maximum number of WebSocket servers reached." });
    }

    const serverPresent = chatRooms.find(
      (server) => server.country === country && server.currentLoad < server.capacity
    );
    const desiredServerCount = chatRooms.filter((server) => server.country === country).length;
    if (serverPresent && serverPresent.currentLoad < serverPresent.capacity) {
      return res.status(200).json({ id: serverPresent.id });
    }

    const serverId = uuidv4();
    const serverInfo = {
      id: serverId,
      name: `${country}-${desiredServerCount + 1}`,
      capacity: 50,
      currentLoad: 0,
      country,
      clients: new Set<string>(),
    };
    await redisInstance.addWebSocketServer(serverInfo);

    return res.status(201).json({ id: serverId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// API endpoint to list all WebSocket servers
app.get("/servers", async (req: Request, res: Response) => {
  try {
    const activeRooms = await redisInstance.getAllWebSocketServers()
    if(activeRooms.length<1){
      return res.status(401).json({ message: 'no active rooms.'})
    }
    // convert set of clients to an array
    const transformedActiveRooms = activeRooms.map((server) => ({
        ...server,
        clients: Array.from(server.clients),
    }));
    return res.status(200).json({transformedActiveRooms});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// WebSocket connection handler
wss.on("connection", async (ws: WebSocket, req: Request) => {
  const params = new URLSearchParams(req.url.split("?")[1]);
  const serverId = params.get("serverId");
  if (!serverId) {
    ws.send(JSON.stringify({ message: "Please add serverId to the connection url" }));
    ws.close();
    return;
  }

  const id = uuidv4();
  redisInstance.setWebSockClientMap(id, ws)
  await redisInstance.subscribeToChannel(serverId, id);
  console.log('sub to channel')
  const serverInfo = await redisInstance.getWebSocketServer(serverId);
  if(!serverInfo){
    ws.send(JSON.stringify({ message: 'Server not found.'}))
  }

  ws.on("message", async (message: string) => {
    try {
      const data = JSON.parse(message);
      const serverMsg = data.message;
      await redisInstance.publishToChannel(serverId, id, serverMsg);
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  ws.on("close", async () => {
    await redisInstance.unSubscribeFromChannel(serverId, id)
  });

  ws.send(JSON.stringify({ message: `Welcome! to ${serverInfo?.name}`, id }));
});

httpServer.listen(3000, () => {
  console.log(`Server is running on port 3000`);
});
