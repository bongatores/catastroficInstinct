import Phaser from 'phaser';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';

import { SimplePool } from 'nostr-tools/pool';

const playerVelocity = 200; // Define a velocity for the player
const maxMoveRadius = 200; // Define a maximum movement radius
const relays = ['wss://relay2.nostrchat.io', 'wss://relay1.nostrchat.io']

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

const RTSGameScene = new Phaser.Class({

    Extends: Phaser.Scene,

    initialize: function RTSGameScene(data) {
        Phaser.Scene.call(this, { key: 'RTSGameScene' });
        this.taprootAssets = data.taprootAssets;
        this.assets = data.assets;
        this.peerInstance = data.peer;
        this.assets = data.assets;
        this.nostrInfo = data.nostrInfo;
        this.connections = []; // Hub only
        this.decodedMetas = [];
    },

    preload: async function () {
        this.renderProgessBar();
        if(this.assets?.length > 0){
            const collectibles = [];
            for(let item of this.assets){
                if(item.assetGenesis.assetType === "COLLECTIBLE"){
                    const decodedMeta = item.decodedMeta;
                    console.log(decodedMeta);
                    collectibles.push(item);
                    console.log(item)
                    //await this.addImageToPhaser(item.assetGenesis.name,decodedMeta);
                        // texture loaded so use instead of the placeholder
                        this.textures.addBase64(item.assetGenesis.name, decodedMeta);
                        this.textures.once('onload', function () {
                            console.log('All textures loaded');
                            console.log(`Texture loaded: ${item.assetGenesis.name}`);
                        })

                } else {
                  // Change cause "server" will handle it
                  if(item.assetGenesis.name === "testasset0") this.force = item.amount;
                  if(item.assetGenesis.name === "testasset1") this.defense = item.amount;
                }
            }
            this.collectibles = collectibles;

        }
        const pool = new SimplePool()
        this.pool = pool;
        let event = await pool.get(relays, {
          kinds: [42],
          '#t':['catastrofic-instinct']
        });
        if(!event){
          this.serverId = this.nostrInfo.pk;
        } else if(event.pubkey !== this.nostrInfo.pk){
          const tagPeerId = event.tags.filter(tag => tag[0] === 'peerJsId')
          console.log(event)
          console.log(tagPeerId)
          this.serverId = tagPeerId[0][1]
        } else {
          this.serverId = this.nostrInfo.pk;
        }
        this.handlePeerEvents();
        this.time.delayedCall(1000,this.sendEnteredGameMsg,[],this);
    },

    create: async function () {


        // Create a group to hold units
        this.units = this.physics.add.group({ collideWorldBounds: true });

        // Array to store units
        this.friendlyUnits = this.physics.add.group();
        this.enemyUnits = this.physics.add.group();
        // Add units using a helper function
        if(this.collectibles?.length > 0){
            this.collectibles.map(item => {
                return(
                  setTimeout(() => {
                    const force = this.force ? this.force/this.collectibles.length : 10;
                    const defense = this.defense ? this.defense/this.collectibles.length : 10;
                    this.addUnit(100, 100,item.assetGenesis.name,item.assetGenesis.decodedMeta,force,defense);
                  },100)
                );
            });
        } else {
            this.addUnit(200, 200);
        }

        // Enable collisions between units to prevent overlap
        this.physics.add.collider(this.friendlyUnits, this.friendlyUnits);
        this.physics.add.collider(this.enemyUnits, this.enemyUnits);

        // Create a graphics object for drawing the selection circle
        this.graphics = this.add.graphics();

        // Enable input for unit selection and movement
        this.input.on('pointerdown', pointer => {
            if (pointer.leftButtonDown()) {
                this.selectUnit(pointer);
            } else if (pointer.rightButtonDown()) {
                this.moveSelectedUnit(pointer);
            }
        });

        this.input.mouse.disableContextMenu();

        this.selectedUnit = null;
    },
    renderProgessBar: function(){
        let progressBar = this.add.graphics();
        let progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(240, 270, 320, 50);

        let width = this.cameras.main.width;
        let height = this.cameras.main.height;
        let loadingText = this.make.text({
            x: width / 2,
            y: height / 2 - 50,
            text: 'Loading...',
            style: {
                font: '20px monospace',
                fill: '#ffffff'
            }
        });
        loadingText.setOrigin(0.5, 0.5);

        let percentText = this.make.text({
            x: width / 2,
            y: height / 2 - 5,
            text: '0%',
            style: {
                font: '18px monospace',
                fill: '#ffffff'
            }
        });
        percentText.setOrigin(0.5, 0.5);

        let assetText = this.make.text({
            x: width / 2,
            y: height / 2 + 50,
            text: '',
            style: {
                font: '18px monospace',
                fill: '#ffffff'
            }
        });
        assetText.setOrigin(0.5, 0.5);
        this.load.on('progress', function (value) {
            percentText.setText(parseInt(value * 100) + '%');
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(250, 280, 300 * value, 30);
        });

        this.load.on('complete', function () {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
            assetText.destroy();
        });
    },
    findUnitById: function(id) {
        // Search in the enemyUnits group
        const unit = this.enemyUnits.getChildren().find(unit => unit.name === id);
        if (unit) {
            return unit;
        } else {
            // Optionally, search in other groups if necessary
            console.log('Unit not found with ID:', id);
            return null;
        }
    },
    addUnit: function(x, y, name = generateRandomString(10), isEnemy = false,decodedMeta=null,force=10,defense=10) {
        const color = isEnemy ? 0xff0000 : 0x00ff00; // Red for enemy, green for friendly
        let unit;
        console.log(name)
        console.log(this.textures.exists(name))
        console.log(decodedMeta)
        if (this.textures.exists(name)) {
            console.log(`Texture ${name} found`);

            unit = this.add.sprite(x, y, name);
            const originalWidth = unit.displayWidth;
            const originalHeight = unit.displayHeight;
            const targetWidth = 25;
            const targetHeight = 25;

            unit.setScale(targetWidth / originalWidth, targetHeight / originalHeight);
            console.log(`Unit with texture ${name} inserted`);
            this.spawnUnit(unit,name,isEnemy,force,defense);
          } else if(decodedMeta){
          this.textures.addBase64(name, decodedMeta);
          const that = this;
          this.textures.once('onload', function () {
              unit = that.add.sprite(x, y, name);
              const originalWidth = unit.displayWidth;
              const originalHeight = unit.displayHeight;
              const targetWidth = 25;
              const targetHeight = 25;

              unit.setScale(targetWidth / originalWidth, targetHeight / originalHeight);
              console.log(`Unit with texture ${name} inserted`);
              console.log(`Texture loaded: ${name}`);
              that.spawnUnit(unit,name,isEnemy,force,defense);
          });
        } else {
          unit = this.add.rectangle(x, y, 25, 25, color);
          this.spawnUnit(unit,name,isEnemy);
        }



    },
    spawnUnit(unit,name,isEnemy,force=10,defense=10){
      this.physics.add.existing(unit);
      unit.body.setCollideWorldBounds(true);
      unit.isEnemy = isEnemy;
      unit.name = name;
      unit.force = force;
      unit.defense = defense;
      this.units.add(unit);
      if (isEnemy && unit) {
          this.enemyUnits.add(unit);
      } else {
          this.friendlyUnits.add(unit);
      }
    },
    selectUnit: function (pointer) {
        // Clear previous graphics
        this.graphics.clear();

        const x = pointer.worldX;
        const y = pointer.worldY;

        this.friendlyUnits.getChildren().forEach(unit => {
            if (unit.getBounds().contains(x, y)) {
                if (this.selectedUnit) {
                    if(this.selectedUnit.type==="Sprite"){
                        this.selectedUnit.setTint(0xFFFFFF);
                    } else {
                        this.selectedUnit.setFillStyle(0x00ff00);
                    }
                }
                this.selectedUnit = unit;
                unit.isSelected = true;
                if(unit.type==="Sprite"){
                    unit.setTint(0x4682B4);
                } else {
                    unit.setFillStyle(0x4682B4);
                }
                // Draw movement radius circle centered on the unit
                this.graphics.lineStyle(2, 0xffff00, 1);
                this.graphics.strokeCircle(unit.x, unit.y, maxMoveRadius);
            } else {
                unit.isSelected = false;
                if(unit.type==="Sprite"){
                    unit.setTint(0xFFFFFF);
                } else {
                    unit.setFillStyle(0x00ff00);
                }
            }
        });
    },

    moveSelectedUnit: function (pointer) {
        if (!this.selectedUnit) return;

        const x = pointer.worldX;
        const y = pointer.worldY;

        const distance = Phaser.Math.Distance.Between(this.selectedUnit.x, this.selectedUnit.y, x, y);
        if (distance <= maxMoveRadius) {
            const unit = this.selectedUnit;
            unit.destinationX = x;
            unit.destinationY = y;
            this.physics.moveTo(this.selectedUnit, x, y, playerVelocity);
            if(unit.type==="Sprite"){
                unit.setTint(0xFFFFFF);
            } else {
                unit.setFillStyle(0x00ff00);
            }
            unit.isSelected = false;
            // Send movement data to peer
            const movementData = {
                id: unit.name, // Ensure each unit has a unique identifier
                x: unit.destinationX,
                y: unit.destinationY,
                velocity: playerVelocity, // Include the velocity
            };
            if(this.conn){
                this.conn.send({
                    type: 'unitMove',
                    data: movementData
                });
            } else if(!this.serverId && this.connections.length > 0){ // Hub will send message to all peers
                this.connections.forEach(c => {
                    c.send({
                        type: 'unitMove',
                        data: movementData
                    });
                });
            }
            this.selectedUnit = null;
            this.graphics.clear();
        } else {
            console.log('Move out of allowed radius');
        }
    },

    update: function () {
        if(this.friendlyUnits) {
          this.friendlyUnits.getChildren().forEach(unit => {
              if (unit.body.speed > 0) {
                  // Check if the unit has reached its destination
                  const distance = Phaser.Math.Distance.Between(unit.x, unit.y, unit.destinationX, unit.destinationY);
                  if (distance < 4) {
                      unit.body.setVelocity(0, 0);
                  }
              }
          });
        }

        if(this.enemyUnits){
          this.enemyUnits.getChildren().forEach(unit => {
              if (unit.body.speed > 0) { // Check if the unit is moving
                  // Calculate the distance to the destination
                  const distance = Phaser.Math.Distance.Between(unit.x, unit.y, unit.destinationX, unit.destinationY);
                  if (distance <= 10) { // Threshold value to stop, adjust as needed
                      unit.body.setVelocity(0, 0); // Stop the unit
                  }
              }
          });
        }
        if(this.enemyUnits && this.friendlyUnits){
          // Example: Check for collisions between friendly and enemy units
          this.physics.collide(this.friendlyUnits, this.enemyUnits, (friendly, enemy) => {
              // Handle collision, e.g., reduce health
              friendly.body.setVelocity(0,0);
              enemy.body.setVelocity(0,0);
              if(friendly.defense < enemy.force){
                friendly.destroy();
              } else {
                enemy.destroy();
              }

          });
        }
    },
    reactToData: function(msg) {
        // Handle data received from PeerJS in Phaser
        console.log('Phaser reacting to msg:', msg);
        // Assuming data is an array of enemy unit positions
        if(typeof(msg) === "object"){
            const data = msg.data;
            if(msg.type === "newConnection"){
                data.forEach(unitData => {
                    this.addUnit(unitData.x, unitData.y,unitData.id, true,unitData.decodedMeta,unitData.force,unitData.defense); // true indicates an enemy unit
                });
            }
            if(msg.type === "unitMove"){
                console.log(data);
                const unit = this.findUnitById(data.id);
                if (unit) {
                    unit.destinationX = data.x;
                    unit.destinationY = data.y;
                    this.physics.moveTo(unit,data.x,data.y,data.velocity);
                    console.log(`Unit ${data.id} moved to (${data.x}, ${data.y}) with velocity ${data.velocity}`);
                    } else {
                    console.log('Unit not found');
                }
            }
        }

    },
    handlePeerEvents: function() {
        // Hub
        if(!this.serverId){
            this.handleHubConn();
        } else {
            this.handlePeerConn();
        }
    },
    handleHubConn: function() {
        this.peerInstance.on('connection', (conn) => {
            this.connections.push(conn);
            console.log("Peer connected: " + conn.peer);
            conn.on('open', () => {
                const unitsData = this.friendlyUnits.getChildren().map(unit => {
                    return {
                        x: unit.x,
                        y: unit.y,
                        health: unit.health, // Assuming units have a health property
                        id: unit.name,
                        force: unit.force,
                        defense: unit.defense,
                        decodedMeta: this.assets ? this.assets.filter(asset => asset.assetGenesis.name === unit.name)[0]?.decodedMeta : null,
                        type: unit.type // Assuming units have a type property
                    };
                });
                console.log(unitsData)
                conn.send({
                    type: "newConnection",
                    data: unitsData
                });
                this.connections.forEach(c => {
                    if (c !== conn) {
                        c.send({
                            type: "newConnection",
                            data: unitsData
                        });
                    }
                });
                const enemyUnitsData = this.enemyUnits.getChildren().map(unit => {
                    return {
                        x: unit.x,
                        y: unit.y,
                        health: unit.health, // Assuming units have a health property
                        id: unit.name,
                        force: unit.force,
                        defense: unit.defense,
                        type: unit.type // Assuming units have a type property
                    };
                });
                conn.send({
                    type: "newConnection",
                    data: enemyUnitsData
                });
            });

            conn.on('data', (data) => {
                console.log('Received data:', data);
                // React to data
                this.reactToData(data);
                this.connections.forEach(c => {
                    if (c !== conn) {
                        c.send(data);
                    }
                });
            });
            conn.on('close', () => {
                console.log("Connection closed with: " + conn.peer);
                this.connections = this.connections.filter(c => c !== conn);
            });
            conn.on('error', (err) => {
                console.error("Connection error with: " + conn.peer, err);
            });

        });
    },
    handlePeerConn: function() {
        // Peer
        const conn = this.peerInstance.connect(this.serverId, {
            reliable: true
        });

        conn.on('open', () => {
            console.log("Connected to: " + conn.peer);
            this.conn = conn;
            // Extract data from friendlyUnits to send
            const unitsData = this.friendlyUnits.getChildren().map(unit => {
                return {
                    x: unit.x,
                    y: unit.y,
                    health: unit.health, // Assuming units have a health property
                    id: unit.name,
                    force: unit.force,
                    defense: unit.defense,
                    decodedMeta: this.assets ? this.assets.filter(asset => asset.assetGenesis.name === unit.name)[0]?.decodedMeta : null,
                    type: unit.type // Assuming units have a type property
                };
            });

            conn.send({
                type: "newConnection",
                data: unitsData
            });
        });

        conn.on('data', (data) => {
            console.log('Received data:', data);
            this.reactToData(data);
        });

        conn.on('close', () => {
            console.log("Connection closed");
        });
        // If error, make it server
        this.peerInstance.on('error', (err) => {
            console.error('PeerJS error:', err);
            this.serverId =  this.nostrInfo.pk;
            if(conn){
              conn.close();
            }
            this.handleHubConn();
        });
    },

    sendEnteredGameMsg: async function(){
      //this.peer.on()
      let signedEvent = finalizeEvent({
        kind: 42,
        pubkey: this.nostrInfo.pk,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e','898e07640acb798a0f8c63099a422cc5f5cf5eb4185f2911f84ce8bc1570bcc4','','root'],
          ['t', 'catastrofic-instinct'],
          ['peerJsId', this.serverId]
        ],
        content: this.serverId ===  this.nostrInfo.pk ? `Just entered as the server!` : `Just entered at server ${this.serverId}!`
      }, this.nostrInfo.sk);
      let isGood = verifyEvent(signedEvent);
      console.log(`Event signed: ${isGood}`);
      if(!isGood) return;
      await Promise.any(this.pool.publish(relays, signedEvent));

    }
});
export default RTSGameScene;
