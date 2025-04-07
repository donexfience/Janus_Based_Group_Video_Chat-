import { useEffect, useRef, useState } from "react";
import JanusJS from "janus-gateway";
import adapter from "webrtc-adapter";

// Define types for better type safety
interface Participant {
  id: string;
  display: string;
  stream: MediaStream | null;
}

function App() {
  const [status, setStatus] = useState("Initializing...");
  const [room, setRoom] = useState("1234");
  const [username, setUsername] = useState(
    `user-${Math.floor(Math.random() * 1000)}`
  );
  const [isJoined, setIsJoined] = useState(false);
  const [participants, setParticipants] = useState<Record<string, Participant>>(
    {}
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const janusRef = useRef<any>(null);
  const pluginHandleRef = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const feedsRef = useRef<Record<string, any>>({});

  const janusServer = "ws://51.21.78.92/janus-ws";

  useEffect(() => {
    // Initialize Janus
    JanusJS.init({
      debug: "all",
      dependencies: JanusJS.useDefaultDependencies({ adapter }),
      callback: initJanus,
    });

    return () => {
      // Cleanup when component unmounts
      if (janusRef.current) {
        janusRef.current.destroy();
      }
    };
  }, []);

  const initJanus = () => {
    setStatus("Connecting to Janus server...");

    janusRef.current = new JanusJS({
      apisecret: "donexfience",
      server: janusServer,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      success: () => {
        setStatus("Connected to Janus, attaching to VideoRoom plugin...");
        attachToVideoRoom();
      },
      error: (error: any) => {
        setStatus(`Error connecting to Janus: ${error.message}`);
        console.error("Janus error:", error);
      },
      destroyed: () => {
        setStatus("Janus instance destroyed");
      },
    });
  };

  const attachToVideoRoom = () => {
    janusRef.current.attach({
      plugin: "janus.plugin.videoroom",
      opaqueId: `videoroom-${JanusJS.randomString(12)}`,
      success: (pluginHandle: any) => {
        pluginHandleRef.current = pluginHandle;
        setStatus("Attached to VideoRoom plugin, ready to join room");
      },
      error: (error: any) => {
        setStatus(`Error attaching to VideoRoom plugin: ${error.message}`);
        console.error("VideoRoom plugin error:", error);
      },
      onmessage: handleOnMessage,
      onlocalstream: (stream: MediaStream) => {
        streamRef.current = stream;
        if (localVideoRef.current) {
          // Ensure the video is properly attached and playing
          localVideoRef.current.srcObject = stream;
          localVideoRef.current
            .play()
            .catch((e) => console.error("Error playing local video:", e));
        }
      },
      onremotestream: (stream: MediaStream) => {
        // Handle remote streams if needed
        console.log("Remote stream received:", stream);
      },
      oncleanup: () => {
        setStatus("VideoRoom plugin cleaned up");
        streamRef.current = null;
      },
    });
  };

  const joinRoom = () => {
    if (!pluginHandleRef.current) {
      setStatus("Plugin not ready yet, please wait");
      return;
    }

    setStatus(`Joining room ${room} as ${username}...`);

    const register = {
      request: "join",
      room: parseInt(room),
      ptype: "publisher",
      display: username,
    };

    pluginHandleRef.current.send({ message: register });
  };

  const publishOwnFeed = () => {
    if (!pluginHandleRef.current) return;

    setStatus("Publishing local feed...");

    pluginHandleRef.current.createOffer({
      media: {
        audioRecv: false,
        videoRecv: false,
        audioSend: isAudioEnabled,
        videoSend: isVideoEnabled,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      },
      success: (jsep: any) => {
        const publish = {
          request: "configure",
          audio: isAudioEnabled,
          video: isVideoEnabled,
        };
        pluginHandleRef.current.send({ message: publish, jsep: jsep });
        setIsPublishing(true);
      },
      error: (error: any) => {
        setStatus(`WebRTC error: ${error.message}`);
        console.error("WebRTC error:", error);
      },
    });
  };

  const subscribeToFeed = (id: string, display: string) => {
    console.log("Subscribing to feed:", id, display);
    let remoteFeed: any = null;

    janusRef.current.attach({
      plugin: "janus.plugin.videoroom",
      opaqueId: `videoroom-${JanusJS.randomString(12)}`,
      success: (pluginHandle: any) => {
        remoteFeed = pluginHandle;

        const subscribe = {
          request: "join",
          room: parseInt(room),
          ptype: "subscriber",
          feed: parseInt(id), // Ensure id is an integer
        };

        remoteFeed.send({ message: subscribe });
      },
      error: (error: any) => {
        console.error("Error attaching to subscriber plugin", error);
      },
      onmessage: (msg: any, jsep: any) => {
        console.log("Received message from subscriber:", msg);
        if (jsep) {
          remoteFeed.createAnswer({
            jsep: jsep,
            media: { audioSend: false, videoSend: false },
            success: (jsep: any) => {
              const body = { request: "start", room: parseInt(room) };
              remoteFeed.send({ message: body, jsep: jsep });
            },
            error: (error: any) => {
              console.error("WebRTC error:", error);
            },
          });
        }
      },
      onremotestream: (stream: MediaStream) => {
        console.log("Remote stream received for participant", id);

        // Make sure we update the state correctly
        setParticipants((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            stream: stream,
          },
        }));

        // Store the plugin handle to use for unsubscribing later
        feedsRef.current[id] = remoteFeed;
      },
      oncleanup: () => {
        setParticipants((prev) => {
          const updated = { ...prev };
          delete updated[id];
          return updated;
        });
        delete feedsRef.current[id];
      },
    });
  };

  const handleOnMessage = (msg: any, jsep: any) => {
    console.log("Received message:", msg);

    if (msg && msg.videoroom) {
      switch (msg.videoroom) {
        case "joined":
          setStatus(`Successfully joined room ${room} with ID ${msg.id}`);
          setIsJoined(true);

          // If there are existing publishers, subscribe to them
          if (msg.publishers && msg.publishers.length > 0) {
            console.log("Existing publishers:", msg.publishers);

            const newParticipants: Record<string, Participant> = {};
            msg.publishers.forEach((publisher: any) => {
              const publisherId = publisher.id.toString();
              newParticipants[publisherId] = {
                id: publisherId,
                display: publisher.display,
                stream: null,
              };
              subscribeToFeed(publisherId, publisher.display);
            });

            setParticipants((prev) => ({ ...prev, ...newParticipants }));
          }

          // Publish our own feed
          publishOwnFeed();
          break;

        case "event":
          if (msg.publishers) {
            // New publishers
            console.log("New publishers:", msg.publishers);

            const newParticipants: Record<string, Participant> = {};
            msg.publishers.forEach((publisher: any) => {
              const publisherId = publisher.id.toString();
              newParticipants[publisherId] = {
                id: publisherId,
                display: publisher.display,
                stream: null,
              };
              subscribeToFeed(publisherId, publisher.display);
            });

            setParticipants((prev) => ({ ...prev, ...newParticipants }));
          } else if (msg.leaving !== undefined) {
            // Publisher left
            console.log("Publisher leaving:", msg.leaving);

            const leavingId = msg.leaving.toString();
            setParticipants((prev) => {
              const updated = { ...prev };
              delete updated[leavingId];
              return updated;
            });

            if (feedsRef.current[leavingId]) {
              feedsRef.current[leavingId].detach();
              delete feedsRef.current[leavingId];
            }
          } else if (msg.error) {
            setStatus(`Error: ${msg.error}`);
          }
          break;

        default:
          break;
      }
    }

    if (jsep) {
      pluginHandleRef.current.handleRemoteJsep({ jsep: jsep });
    }
  };

  const leaveRoom = () => {
    if (pluginHandleRef.current) {
      const leave = { request: "leave" };
      pluginHandleRef.current.send({ message: leave });
      pluginHandleRef.current.detach();
      pluginHandleRef.current = null;
    }

    // Detach all feeds
    Object.values(feedsRef.current).forEach((feed) => {
      if (feed) feed.detach();
    });

    feedsRef.current = {};
    setParticipants({});
    setIsJoined(false);
    setIsPublishing(false);
    setStatus("Left the room");

    // Stop local stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const toggleAudio = () => {
    if (pluginHandleRef.current && isPublishing) {
      const newAudioState = !isAudioEnabled;
      setIsAudioEnabled(newAudioState);

      pluginHandleRef.current.send({
        message: {
          request: "configure",
          audio: newAudioState,
          video: isVideoEnabled,
        },
      });
    }
  };

  const toggleVideo = () => {
    if (pluginHandleRef.current && isPublishing) {
      const newVideoState = !isVideoEnabled;
      setIsVideoEnabled(newVideoState);

      pluginHandleRef.current.send({
        message: {
          request: "configure",
          audio: isAudioEnabled,
          video: newVideoState,
        },
      });
    }
  };

  return (
    <div className="App">
      <h1>Janus Group Video Chat Test</h1>
      <div className="status-bar">
        <p>Status: {status}</p>
      </div>

      {!isJoined ? (
        <div className="join-form">
          <div className="form-group">
            <label>Your Name:</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Room Number:</label>
            <input
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            />
          </div>
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div className="video-room">
          <div className="controls">
            <button onClick={toggleAudio}>
              {isAudioEnabled ? "Mute Audio" : "Unmute Audio"}
            </button>
            <button onClick={toggleVideo}>
              {isVideoEnabled ? "Turn Off Video" : "Turn On Video"}
            </button>
            <button onClick={leaveRoom}>Leave Room</button>
          </div>

          <div className="video-container">
            <div className="video-box local-video">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div className="video-label">You ({username})</div>
            </div>

            {Object.values(participants).map((participant) => (
              <div key={participant.id} className="video-box">
                <video
                  id={`video-${participant.id}`}
                  autoPlay
                  playsInline
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  ref={(el) => {
                    if (el && participant.stream) {
                      // Directly setting srcObject is more reliable
                      if (el.srcObject !== participant.stream) {
                        el.srcObject = participant.stream;
                        el.play().catch((e) =>
                          console.error(
                            `Error playing remote video ${participant.id}:`,
                            e
                          )
                        );
                      }
                    }
                  }}
                />
                <div className="video-label">{participant.display}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .App {
          font-family: Arial, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        
        h1 {
          text-align: center;
        }
        
        .status-bar {
          background-color: #f0f0f0;
          padding: 10px;
          margin-bottom: 20px;
          border-radius: 4px;
        }
        
        .join-form {
          max-width: 400px;
          margin: 0 auto;
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 5px;
        }
        
        .form-group input {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        
        button {
          background-color: #4CAF50;
          color: white;
          border: none;
          padding: 10px 15px;
          margin: 5px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        button:hover {
          background-color: #45a049;
        }
        
        .video-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }
        
        .video-box {
          position: relative;
          background-color: #000;
          border-radius: 8px;
          overflow: hidden;
          aspect-ratio: 4/3;
        }
        
        .video-label {
          position: absolute;
          bottom: 10px;
          left: 10px;
          background-color: rgba(0, 0, 0, 0.5);
          color: white;
          padding: 5px 10px;
          border-radius: 4px;
        }
        
        .controls {
          margin: 20px 0;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

export default App;
