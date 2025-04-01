const SIGNALING_SERVER = "https://webrtc-signaling.purduehackers.com";

// Global variables for managing the peer-to-peer connection.
let pc: RTCPeerConnection; // The main RTCPeerConnection object for WebRTC.
let dataChannel: RTCDataChannel; // Data channel used for sending/receiving messages.
let roomId: string = ""; // Unique room identifier provided by the signaling server.
let isOfferer: boolean = false; // Indicates whether this peer is the offerer.

/**
 * Initialize the RTCPeerConnection, register callbacks to handle ICE candidate
 * events, and monitor connection state changes. This is crucial
 * for establishing and maintaining the P2P connection.
 */
function setupPeerConnection() {
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      // When an ICE candidate is discovered, send it to the signaling server.
      fetch(`${SIGNALING_SERVER}/api/candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, candidate: event.candidate, isOfferer }),
      }).catch(console.error);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    // When the connection state becomes "connected", the P2P connection is established.
    if (pc.connectionState === "connected") {
      displayStatus("Peer connection established!", "green");
      showChatUI();
    }
  };
}

/**
 * Configure the RTCDataChannel to handle sending and receiving messages.
 * The data channel provides a real-time communication pathway between peers.
 */
function setupDataChannel(channel: RTCDataChannel) {
  channel.onopen = () => {
    console.log("Data channel open");
    // Notify that the data channel is open and ready for communication.
    displayStatus("Data channel open. You can now send messages.", "green");
    showChatUI();
  };

  channel.onmessage = (event) => {
    console.log("Message received:", event.data);
    // Display any incoming message from the remote peer.
    displayMessage(`Peer: ${event.data}`);
  };
}

/**
 * Implements the offerer flow. This function creates a room,
 * generates an SDP offer, sends it to the signaling server, and begins polling
 * for an SDP answer and remote ICE candidates.
 */
async function startOfferer() {
  isOfferer = true;
  // Create a new room by requesting the signaling server.
  const res = await fetch(`${SIGNALING_SERVER}/api/rooms/create`, {
    method: "POST",
  });
  const data = await res.json();
  roomId = data.roomId;
  displayStatus(`Room created. Share Room ID: ${roomId}`, "green");

  // Initialize the RTCPeerConnection and set up ICE handling.
  pc = new RTCPeerConnection();
  setupPeerConnection();

  // Create a data channel for communication.
  dataChannel = pc.createDataChannel("chat");
  setupDataChannel(dataChannel);

  // Create an SDP offer and set it as the local description.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Send the generated offer to the signaling server.
  await fetch(`${SIGNALING_SERVER}/api/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, offer: pc.localDescription }),
  });

  // Begin polling for the remote answer and ICE candidates.
  pollForAnswer();
  pollCandidates();
}

/**
 * Implements the answerer flow. This function joins an existing room,
 * polls for an SDP offer, sets it as the remote description, creates an SDP answer,
 * sends the answer back to the signaling server, and starts polling for ICE candidates.
 */
async function startAnswerer(room: string) {
  isOfferer = false;
  roomId = room;
  displayStatus(`Joining room: ${roomId}`, "green");

  // Initialize the RTCPeerConnection and set up ICE handling.
  pc = new RTCPeerConnection();
  setupPeerConnection();

  // Listen for an incoming data channel from the offerer.
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };

  // Poll the signaling server until an offer is available.
  const offer = await pollForOffer();
  if (!offer) {
    displayStatus("No offer found for room.", "red");
    return;
  }
  // Set the received offer as the remote description.
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  // Create an SDP answer and set it as the local description.
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Send the answer back to the signaling server.
  await fetch(`${SIGNALING_SERVER}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, answer: pc.localDescription }),
  });

  // Start polling for remote ICE candidates.
  pollCandidates();
}

/**
 * Continuously poll the signaling server until an offer is received.
 * Used by the answerer to wait for the offer from the offerer.
 */
async function pollForOffer(): Promise<any> {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const res = await fetch(`${SIGNALING_SERVER}/api/offer?roomId=${roomId}`);
      const data = await res.json();
      if (data.offer) {
        clearInterval(interval);
        resolve(data.offer);
      }
    }, 1000);
  });
}

/**
 * Continuously poll the signaling server for an SDP answer.
 * Used by the offerer to wait for the remote peer's answer.
 */
function pollForAnswer() {
  const interval = setInterval(async () => {
    // Only poll if the connection is still expecting an answer.
    if (pc.signalingState !== "have-local-offer") {
      clearInterval(interval);
      return;
    }

    const res = await fetch(`${SIGNALING_SERVER}/api/answer?roomId=${roomId}`);
    const data = await res.json();
    if (data.answer) {
      clearInterval(interval);
      // Confirm that the peer connection is still in the correct state before setting the answer.
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    }
  }, 1000);
}

/**
 * Continuously poll the signaling server for remote ICE candidates,
 * and add each candidate to the RTCPeerConnection. This supports trickle ICE,
 * where candidates may be received over time.
 */
function pollCandidates() {
  setInterval(async () => {
    const res = await fetch(
      `${SIGNALING_SERVER}/api/candidates?roomId=${roomId}&isOfferer=${isOfferer ? "1" : "0"}`,
    );
    const data = await res.json();
    if (data.candidates && data.candidates.length > 0) {
      for (const candidate of data.candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding candidate", e);
        }
      }
    }
  }, 1000);
}

const STATUS_COLORS = {
  green: "bg-green-500",
  red: "bg-red-500",
  gray: "bg-gray-300",
};

function displayMessage(message: string) {
  const messagesDiv = document.getElementById("messages-container");
  if (messagesDiv) {
    const p = document.createElement("p");
    p.textContent = message;
    messagesDiv.appendChild(p);
  }
}

function displayStatus(
  message: string,
  color: "red" | "green" | "gray" = "gray",
) {
  const statusDiv = document.getElementById("status");
  if (statusDiv) {
    statusDiv.textContent = message;
  }

  const indicatorDiv = document.getElementById("indicator");
  if (indicatorDiv) {
    for (const colorClass of Object.values(STATUS_COLORS)) {
      indicatorDiv.classList.remove(colorClass);
    }

    indicatorDiv.classList.add(STATUS_COLORS[color]);
  }
}

function showChatUI() {
  const chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    chatContainer.classList.remove("hidden");
  }
  setupChatSend();
}

function setupChatSend() {
  const sendButton = document.getElementById("send-button");
  const chatInput = document.getElementById("chat-input") as HTMLInputElement;
  if (sendButton && chatInput) {
    sendButton.addEventListener("click", () => {
      const message = chatInput.value;
      if (message && dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(message);
        displayMessage(`Me: ${message}`);
        chatInput.value = "";
      }
    });
  }
}

function setupEventListeners() {
  const createRoomButton = document.getElementById("create-room-button");
  const joinRoomButton = document.getElementById("join-room-button");
  const roomIdInput = document.getElementById(
    "room-id-input",
  ) as HTMLInputElement;

  if (createRoomButton) {
    createRoomButton.addEventListener("click", () => {
      startOfferer();
    });
  }

  if (joinRoomButton) {
    joinRoomButton.addEventListener("click", () => {
      const room = roomIdInput.value.trim();
      if (room) {
        startAnswerer(room);
      } else {
        displayMessage("Please enter a room ID to join.");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});
