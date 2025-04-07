# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
 
janus provide a MCU based streaming faetures for a better streaming with the help of plugins it supports many transport 
https://janus.conf.meetecho.com/docs/
for the server side setup you



# Janus WebRTC Server Setup Guide for Multi-User Streaming Platform

This comprehensive guide walks you through setting up a Janus WebRTC server on AWS EC2 to support a streaming platform with the following features:

- Host streaming capability
- Guest participation and streaming
- Participants watching each other's streams
- Support for subscribers/viewers
- Chat functionality between participants

## Table of Contents
- [1. Launch and Configure EC2 Instance](#1-launch-and-configure-ec2-instance)
- [2. Install Dependencies](#2-install-dependencies)
- [3. Install libnice (ICE library)](#3-install-libnice-ice-library)
- [4. Install and Configure Janus](#4-install-and-configure-janus)
- [5. Setup Nginx as Reverse Proxy](#5-setup-nginx-as-reverse-proxy)
- [6. Setup SSL with Certbot](#6-setup-ssl-with-certbot)
- [7. Create a Janus Systemd Service](#7-create-a-janus-systemd-service)
- [8. Integrating With Your React Component](#8-integrating-with-your-react-component)
- [9. Security Considerations](#9-security-considerations)
- [10. Potential Improvements](#10-potential-improvements)
- [Troubleshooting](#troubleshooting)

## 1. Launch and Configure EC2 Instance

### Requirements
- **EC2 Instance type**: t3.large or better (for multiple simultaneous streams)
- **OS**: Ubuntu Server 22.04 LTS
- **Open ports**: 80, 443, 8088, 8089, UDP 10000-10200 (for WebRTC)

SSH into your EC2 instance:
```bash
ssh -i your-key.pem ubuntu@your-ec2-instance-public-ip
```

## 2. Install Dependencies

Update your system and install required dependencies:
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y build-essential libmicrohttpd-dev libjansson-dev \
    libssl-dev libsofia-sip-ua-dev libglib2.0-dev \
    libopus-dev libogg-dev libcurl4-openssl-dev liblua5.3-dev \
    libconfig-dev pkg-config gengetopt libtool automake nginx certbot \
    python3-certbot-nginx libsrtp2-dev libnice-dev \
    libwebsockets-dev cmake git
```

## 3. Install libnice (ICE library)

```bash
sudo apt install -y libnice-dev
```

## 4. Install and Configure Janus

### Clone and build Janus
```bash
cd ~
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
sh autogen.sh
./configure --prefix=/opt/janus --enable-websockets --enable-rest --enable-data-channels
make
sudo make install
sudo make configs
```

### Configure Janus

Edit the main configuration file:
```bash
sudo nano /opt/janus/etc/janus/janus.jcfg
```

Update these sections:
```json
general: {
    debug_level = 4  # Debug level (0-7)
    admin_secret = "your-admin-secret-here"  # Change this!
    api_secret = "your-api-secret-here"      # Change this!
    token_auth = false  # Enable if you want token-based authentication
    events = true  # Enable event handlers
}

media: {
    rtp_port_range = "10000-10200"  # UDP port range for RTP/media
    dtls_timeout = 500  # DTLS timeout in milliseconds
}

nat: {
    ice_lite = true
    ice_tcp = true
    stun_server = "stun.l.google.com"
    stun_port = 19302
}

plugins: {
    disable = "libjanus_echotest.so,libjanus_recordplay.so,libjanus_textroom.so"
}
```

### Configure WebSocket transport

Edit the WebSocket configuration:
```bash
sudo nano /opt/janus/etc/janus/janus.transport.websockets.jcfg
```

Configure it:
```json
general: {
    json = "indented"
    ws = true
    ws_port = 8188
    wss = true
    wss_port = 8989
    ws_logging = "info"
    ws_acl = "127.,172.16.,192.168."
}
```

### Configure VideoRoom plugin

This is the key plugin for your multi-user streaming scenario:
```bash
sudo nano /opt/janus/etc/janus/janus.plugin.videoroom.jcfg
```

Configure it:
```json
general: {
    admin_key = "your-admin-key"  # Change this
    events = true
    allowed_codecs = "h264,vp8,vp9,opus"
}

room-1234: {
    description = "Studio Room"
    is_private = false
    secret = "studio-room-secret"  # Change this
    publishers = 10
    bitrate = 1024000
    fir_freq = 10
    audiocodec = "opus"
    videocodec = "vp8,h264"
    record = false
    notify_joining = true
}
```

## 5. Setup Nginx as Reverse Proxy

Create an Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/janus
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /var/www/html;
        index index.html;
    }

    location /janus {
        proxy_pass http://localhost:8088/janus;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:8188/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/janus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 6. Setup SSL with Certbot

```bash
sudo certbot --nginx -d your-domain.com
```

## 7. Create a Janus Systemd Service

Create a service file:
```bash
sudo nano /etc/systemd/system/janus.service
```

Add this configuration:
```ini
[Unit]
Description=Janus WebRTC Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/janus/bin/janus -o
Restart=on-abnormal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable janus
sudo systemctl start janus
sudo systemctl status janus
```

## 8. Integrating With Your React Component

Based on your React component, you'll need to integrate the Janus client library to connect to your server.

### Install Janus Client Library
```bash
npm install janus-gateway-js
```

### Create a Janus Service

Create a new file called `janusService.js` to handle connections to your Janus server:

```javascript
import { Janus } from 'janus-gateway';

class JanusService {
  constructor() {
    this.janus = null;
    this.videoRoomPlugin = null;
    this.initialized = false;
    this.myRoomId = 1234; // Match the room ID in your Janus config
    this.myUsername = '';
    this.myId = null;
    this.localStream = null;
    this.participants = {};
    this.onParticipantJoinedCallback = null;
    this.onLocalStreamReadyCallback = null;
    this.onRemoteStreamAddedCallback = null;
    this.onRemoteStreamRemovedCallback = null;
  }

  init(serverUrl, onSuccess, onError) {
    Janus.init({
      debug: "all",
      callback: () => {
        this.janus = new Janus({
          server: serverUrl,
          success: () => {
            this.initialized = true;
            if (onSuccess) onSuccess();
          },
          error: (error) => {
            if (onError) onError(error);
          },
          destroyed: () => {
            console.log('Janus destroyed');
          }
        });
      }
    });
  }

  // Attach to VideoRoom plugin
  attachToVideoRoom(onSuccess, onError) {
    if (!this.initialized) {
      if (onError) onError('Janus not initialized');
      return;
    }

    this.janus.attach({
      plugin: 'janus.plugin.videoroom',
      opaqueId: `videoroom-${Janus.randomString(12)}`,
      success: (pluginHandle) => {
        this.videoRoomPlugin = pluginHandle;
        if (onSuccess) onSuccess();
      },
      error: (error) => {
        if (onError) onError(error);
      },
      onmessage: (msg, jsep) => this.onVideoRoomMessage(msg, jsep),
      onlocalstream: (stream) => {
        this.localStream = stream;
        if (this.onLocalStreamReadyCallback) {
          this.onLocalStreamReadyCallback(stream);
        }
      },
      onremotestream: (stream) => {
        // This is for subscribers
        if (this.onRemoteStreamAddedCallback && stream.id) {
          this.onRemoteStreamAddedCallback(stream);
        }
      }
    });
  }

  // Join room as publisher (host or guest)
  joinRoomAsPublisher(username, room = this.myRoomId) {
    this.myUsername = username;
    
    const register = {
      request: 'join',
      room: room,
      ptype: 'publisher',
      display: username
    };
    
    this.videoRoomPlugin.send({ message: register });
  }

  // Join room as subscriber (viewer)
  joinRoomAsSubscriber(room = this.myRoomId) {
    const register = {
      request: 'join',
      room: room,
      ptype: 'subscriber'
    };
    
    this.videoRoomPlugin.send({ message: register });
  }

  // Publish stream (for host/guest)
  publishStream(useAudio = true, useVideo = true) {
    this.videoRoomPlugin.createOffer({
      media: { 
        audioRecv: false, 
        videoRecv: false, 
        audioSend: useAudio, 
        videoSend: useVideo 
      },
      success: (jsep) => {
        const publish = { request: 'configure', audio: useAudio, video: useVideo };
        this.videoRoomPlugin.send({ message: publish, jsep: jsep });
      },
      error: (error) => {
        console.error('WebRTC error:', error);
      }
    });
  }

  // Subscribe to a participant's stream
  subscribeToParticipant(feedId, feedDisplay) {
    const subscription = {
      request: 'join',
      room: this.myRoomId,
      ptype: 'subscriber',
      feed: feedId,
      private_id: this.myPrivateId
    };
    
    this.janus.attach({
      plugin: 'janus.plugin.videoroom',
      opaqueId: `videoroom-${Janus.randomString(12)}`,
      success: (pluginHandle) => {
        this.participants[feedId] = {
          handle: pluginHandle,
          displayName: feedDisplay
        };
        pluginHandle.send({ message: subscription });
      },
      error: (error) => {
        console.error('Error attaching to subscriber plugin', error);
      },
      onmessage: (msg, jsep) => {
        if (jsep) {
          this.participants[feedId].handle.createAnswer({
            jsep: jsep,
            media: { audioSend: false, videoSend: false },
            success: (jsep) => {
              const body = { request: 'start', room: this.myRoomId };
              this.participants[feedId].handle.send({ message: body, jsep: jsep });
            },
            error: (error) => {
              console.error('WebRTC error:', error);
            }
          });
        }
      },
      onremotestream: (stream) => {
        if (this.onRemoteStreamAddedCallback) {
          this.onRemoteStreamAddedCallback(stream, feedId, feedDisplay);
        }
      },
      oncleanup: () => {
        if (this.onRemoteStreamRemovedCallback) {
          this.onRemoteStreamRemovedCallback(feedId);
        }
      }
    });
  }

  // Handle incoming messages from the VideoRoom plugin
  onVideoRoomMessage(msg, jsep) {
    if (msg && msg.videoroom) {
      switch (msg.videoroom) {
        case 'joined':
          this.myId = msg.id;
          this.myPrivateId = msg.private_id;
          
          // Subscribe to existing participants
          if (msg.publishers && msg.publishers.length > 0) {
            msg.publishers.forEach(publisher => {
              this.subscribeToParticipant(publisher.id, publisher.display);
              
              if (this.onParticipantJoinedCallback) {
                this.onParticipantJoinedCallback({
                  id: publisher.id,
                  display: publisher.display
                });
              }
            });
          }
          break;
          
        case 'event':
          // New publisher joined
          if (msg.publishers && msg.publishers.length > 0) {
            msg.publishers.forEach(publisher => {
              this.subscribeToParticipant(publisher.id, publisher.display);
              
              if (this.onParticipantJoinedCallback) {
                this.onParticipantJoinedCallback({
                  id: publisher.id,
                  display: publisher.display
                });
              }
            });
          }
          
          // Publisher left
          if (msg.leaving) {
            const feedId = msg.leaving;
            if (this.participants[feedId]) {
              this.participants[feedId].handle.detach();
              delete this.participants[feedId];
            }
          }
          break;
      }
    }
    
    // Handle WebRTC negotiations
    if (jsep) {
      this.videoRoomPlugin.handleRemoteJsep({ jsep: jsep });
    }
  }

  // Set callbacks
  setOnParticipantJoined(callback) {
    this.onParticipantJoinedCallback = callback;
  }
  
  setOnLocalStreamReady(callback) {
    this.onLocalStreamReadyCallback = callback;
  }
  
  setOnRemoteStreamAdded(callback) {
    this.onRemoteStreamAddedCallback = callback;
  }
  
  setOnRemoteStreamRemoved(callback) {
    this.onRemoteStreamRemovedCallback = callback;
  }

  // Disconnect
  disconnect() {
    if (this.videoRoomPlugin) {
      this.videoRoomPlugin.send({ message: { request: 'leave' } });
      this.videoRoomPlugin.detach();
      this.videoRoomPlugin = null;
    }
    
    if (this.janus) {
      this.janus.destroy();
      this.janus = null;
    }
    
    this.initialized = false;
    this.participants = {};
  }
}

export default new JanusService();
```

### Integrate Janus with Your React Component

```javascript
// Add this in your component
useEffect(() => {
  if (streamingSocket) {
    // Initialize Janus
    janusService.init(
      'wss://your-domain.com/ws', // Your Janus WebSocket endpoint
      () => {
        console.log('Janus initialized');
        
        // Attach to VideoRoom plugin
        janusService.attachToVideoRoom(
          () => {
            console.log('Attached to VideoRoom plugin');
            
            // Join room as publisher for host/guest
            janusService.joinRoomAsPublisher(user.username);
            
            // Start publishing stream if camera/mic is on
            if (initialCameraOn || initialMicOn) {
              janusService.publishStream(initialMicOn, initialCameraOn);
            }
          },
          (error) => console.error('Error attaching to VideoRoom plugin', error)
        );
      },
      (error) => console.error('Error initializing Janus', error)
    );
    
    // Set callbacks
    janusService.setOnParticipantJoined((participant) => {
      console.log('Participant joined:', participant);
      setParticipants((prev) => {
        const exists = prev.some((p) => p.userId === participant.id);
        return exists ? prev : [...prev, {
          userId: participant.id,
          username: participant.display,
          // Add other properties as needed
        }];
      });
    });
    
    janusService.setOnLocalStreamReady((stream) => {
      // Handle local stream (e.g., add to video element)
      console.log('Local stream ready');
      // You'll need to add a method to your StreamView component to handle this
    });
    
    janusService.setOnRemoteStreamAdded((stream, feedId, feedDisplay) => {
      // Handle remote stream (e.g., add to video element)
      console.log('Remote stream added from', feedDisplay);
      // You'll need to add a method to your StreamView component to handle this
    });
    
    janusService.setOnRemoteStreamRemoved((feedId) => {
      // Handle remote stream removal
      console.log('Remote stream removed');
      // Update participants state to remove this user
    });
    
    return () => {
      // Cleanup
      janusService.disconnect();
    };
  }
}, [streamingSocket, role, user, initialCameraOn, initialMicOn]);
```

### Update StreamView Component

You'll need to update your StreamView component to handle the streams:

```jsx
// In your StreamView component
const StreamView = ({ streamSettings, participants, currentLayout, setCurrentLayout }) => {
  const videoRefs = useRef({});
  
  useEffect(() => {
    // Function to handle new streams
    window.addStream = (stream, participantId) => {
      if (videoRefs.current[participantId]) {
        videoRefs.current[participantId].srcObject = stream;
      }
    };
    
    return () => {
      delete window.addStream;
    };
  }, []);
  
  return (
    <div className="stream-container" style={{ 
      background: streamSettings.background,
      // other styling
    }}>
      <div className={`stream-layout ${currentLayout}`}>
        {participants.map((participant) => (
          <div key={participant.userId} className="stream-box">
            <video
              ref={(el) => { if (el) videoRefs.current[participant.userId] = el; }}
              autoPlay
              playsInline
              muted={participant.userId === localUserId}
            />
            <div className="participant-name">{participant.username}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 9. Security Considerations

- **API and Admin Secrets**: Use strong, unique secrets for the API and admin interfaces.
- **Firewall Rules**: Configure your EC2 security group to only allow required ports.
- **Room Access Control**: Implement room access tokens to control who can join which rooms.
- **HTTPS**: Always use SSL/TLS for all communications.
- **Regular Updates**: Keep Janus and all dependencies updated to patch security vulnerabilities.

## 10. Potential Improvements

- **Load Balancing**: For high-scale deployments, consider setting up multiple Janus instances behind a load balancer.
- **Recording**: Enable recording functionality if needed for future playback.
- **Monitoring**: Implement monitoring using Prometheus and Grafana to track server health and usage.
- **Bandwidth Control**: Use SVC (Scalable Video Coding) to dynamically adapt to network conditions.
- **Turn Server**: Set up a TURN server for connections that can't establish direct peer connections.

## Troubleshooting

- Check Janus logs: `sudo journalctl -u janus`
- Test WebRTC connectivity: Use https://test.webrtc.org/
- Verify ports are open: `sudo netstat -tulpn | grep janus`
- Check STUN/TURN connectivity: Use https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

---

## About Janus

Janus is a WebRTC Server developed by [Meetecho](https://janus.conf.meetecho.com/docs/). It provides MCU-based streaming features through various plugins.

For more detailed documentation, visit: https://janus.conf.meetecho.com/docs/
