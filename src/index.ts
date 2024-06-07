import express, { Request, Response } from "express";
import http from "http";
import WebSocket, { Server as WebSocketServer } from "ws";
import { clientRds, publisher } from "./redis";
import { v4 as uuidv4 } from "uuid";

// Initialize Express app
const app = express();
// parsing json data
app.use(express.json({ limit: "30mb" }));
const httpServer = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Interface for WebSocket server information
interface WebSocketServerInfo {
  id: string;
  capacity: number;
  currentLoad: number;
  country: string;
  clients: Set<string>;
}

// Map to store WebSocket server information <serverId, WSInfo>
const webSocketServers = new Map<string, WebSocketServerInfo>();

// Map to store client information
const clients = new Map<string, string>(); // Map of client ID to server ID
const websockClientMap = new Map<string, WebSocket>(); // Map of WebSocket to clientId

// Broadcast message to all clients except the sender
const broadcastMessageToClients = (serverId: string, senderId: string, message: string) => {
  const serverInfo = webSocketServers.get(serverId);
  if (serverInfo) {
    serverInfo.clients.forEach(clientId => {
      if (clientId !== senderId) {
        const clientWs = websockClientMap.get(clientId);
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            event: 'message',
            message,
            senderId,
          }));
        }
      }
    });
  }
};

// API endpoint to create a new WebSocket server
app.post("/servers", async (req: Request, res: Response) => {
  try {
    let { country } = req.body;
    if (!country) {
      return res.status(400).json({ error: "Required parameters missing." });
    }
    country = country.toLowerCase();
    // Check if the maximum number of servers is reached
    if (webSocketServers.size >= 50) {
      return res
        .status(429)
        .json({ error: "Maximum number of WebSocket servers reached." });
    }

    // Check if server already exists for the country
    const webSocketServersArr = Array.from(webSocketServers.values());
    const serverPresent = webSocketServersArr.find(
      (server) => server.country === country
    );
    if (serverPresent && serverPresent.currentLoad < serverPresent.capacity)
      return res.status(200).json({ id: serverPresent.id });

    // Generate a unique identifier for the WebSocket server
    const serverId = uuidv4();

    // Add the WebSocket server to the map
    webSocketServers.set(serverId, {
      id: serverId,
      capacity: 50, // Assuming capacity of 50 for each server
      currentLoad: 0,
      country, // Assuming country is passed in the request body
      clients: new Set<string>(),
    });

    // Return success response with serverId
    return (
      res
        .status(201)
        // .cookie("id", clientId, {
        //   maxAge: 3600 * 1000,
        // })
        .json({ id: serverId })
    );
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// API endpoint to list all WebSocket servers
app.get("/servers", async (req: Request, res: Response) => {
  try {
    // Return the list of WebSocket servers
    return res.status(200).json(Array.from(webSocketServers.values()));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// API endpoint to update WebSocket server information
app.put("/servers/:id", async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;
    const serverInfo = webSocketServers.get(serverId);

    // Check if the server exists
    if (!serverInfo) {
      return res.status(404).json({ error: "WebSocket server not found." });
    }

    // Update server information
    serverInfo.capacity = req.body.capacity;
    serverInfo.country = req.body.country;

    // Return success response
    return res
      .status(200)
      .json({ message: "WebSocket server updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// API endpoint to delete a WebSocket server
app.delete("/servers/:id", async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;

    // Check if the server exists
    if (!webSocketServers.has(serverId)) {
      return res.status(404).json({ error: "WebSocket server not found." });
    }

    // Remove the WebSocket server from the map
    webSocketServers.delete(serverId);

    // Return success response
    return res
      .status(200)
      .json({ message: "WebSocket server deleted successfully." });
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
    ws.send(
      JSON.stringify({ message: "Please add serverId to the connection url" })
    );
    ws.close();
    return;
  }
  const id = uuidv4();
  websockClientMap.set(id, ws);
  // Update currentLoad for the WebSocket server
  const serverInfo = webSocketServers.get(serverId);
  const isSubscribed = webSocketServers.get(serverId)?.clients.has(id)
  if(!isSubscribed){
    // Subscribe to Redis channel for real-time updates
    console.log('subscribe for: ', id)
    await clientRds.subscribe(
      serverId,
      (message: string, channel: string) => {
      }
    );
    if (serverInfo) {
      serverInfo.currentLoad++;
      serverInfo.clients.add(id);
      webSocketServers.set(serverId, serverInfo);
    }
  }
  ws.on("message", async (message: string) => {
    try {
      const data = JSON.parse(message);
      // const serverId = data.serverId;
      const serverMsg = data.message;

      // Store client information
      clients.set(id, serverId);

      // Publish message to Redis channel
      await publisher.publish(
        serverId,
        JSON.stringify({
          event: "client_connected",
          clientId: id,
          serverId,
          serverMsg,
        })
      );
      broadcastMessageToClients(serverId, id, serverMsg);
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  ws.on("close", () => {
    // Handle client disconnection
    // const clientId = [...clients.entries()].find(([key, value]) => value === clientId)?.[0];
    if (id) {
      // const serverId = clients.get(id);
      if (serverId) {
        // Update currentLoad for the WebSocket server
        const serverInfo = webSocketServers.get(serverId);
        if (serverInfo) {
          serverInfo.currentLoad--;
          serverInfo.clients.delete(id);
          webSocketServers.set(serverId, serverInfo);
        }

        // Unsubscribe from Redis channel
        clientRds.unsubscribe("websocket_updates");

        // Publish message to Redis channel
        clientRds.publish(
          "websocket_updates",
          JSON.stringify({ event: "client_disconnected", clientId: id, serverId })
        );

        // Remove client information
        clients.delete(id);
      }
    }
  });
  ws.send(
    JSON.stringify({
      message: "Welcome!",
      id,
    })
  );
});

// Start the HTTP server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
