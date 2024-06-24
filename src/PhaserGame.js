import React, { useEffect, useRef, useState,useCallback } from 'react';
import Phaser from 'phaser';
import LNC from '@lightninglabs/lnc-web';
import Peer from 'peerjs';
import { Buffer } from 'buffer';
import { generateSecretKey, getPublicKey,finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';

import { Relay } from 'nostr-tools/relay'

import RTSGameScene from "./RTSGameScene"
const marketPubKey = "748435f3920646e47889c83a9ce4a44fe75cb54ec926f319593770de24aeca36";

const PhaserGame = () => {
    const gameContainer = useRef();
    const [peer, setPeer] = useState(null);

    const [gameStarted, setGameStarted] = useState(false);
    const [pairingPhrase, setPairingPhrase] = useState('');
    const [lndInfo, setLndInfo] = useState(null);
    const [taprootAssets, setTaprootAssets] = useState(1);
    const [assets, setAssets] = useState([]);
    const [nostrInfo,setNostrInfo] = useState();
    const [relay,setRelay] = useState();
    const [events,setEvents] = useState();
    const [lnd,setLnd] = useState();
    const [router,setRouter] = useState();
    const connectLNC = () => {
        if (pairingPhrase) {
            const newLnc = new LNC({
                pairingPhrase: pairingPhrase,
            });
            newLnc.connect().then(async () => {
                const { tapd,lnd } = newLnc;
                const { lightning , router } = lnd;
                setTaprootAssets(tapd.taprootAssets);
                console.log(tapd.taprootAssets)
                const info = await lightning.getInfo();
                setLnd(lightning);
                setRouter(router)
                console.log(info)
                setLndInfo(info);
                const checkAssetsReady = async () => {
                    try {
                        const assetsTap = await tapd.taprootAssets.listAssets();
                        console.log(assetsTap);

                        let assetsArr = [];
                        for(let asset of assetsTap.assets){

                            const proof = await tapd.taprootAssets.exportProof({
                              asset_id: asset.assetGenesis.assetId,
                              script_key: asset.scriptKey
                            });
                            /*
                            console.log(proof.rawProofFile.replace(/\+/g, '-').replace(/\//g, '_'))
                            const validation = await tapd.taprootAssets.verifyProof({
                              raw_proof_file: proof.rawProofFile.replace(/\+/g, '-').replace(/\//g, '_')
                            });
                            console.log(validation);
                            */
                            if(asset.assetGenesis.assetType === "COLLECTIBLE"){
                                const meta = await tapd.taprootAssets.fetchAssetMeta({asset_id: asset.assetGenesis.assetId.replace(/\+/g, '-').replace(/\//g, '_')});
                                assetsArr.push({
                                    ...asset,
                                    decodedMeta: Buffer.from(meta.data,'base64').toString('utf8'),
                                    rawProofFile: proof.rawProofFile.replace(/\+/g, '-').replace(/\//g, '_')
                                });
                            } else {
                                assetsArr.push({
                                  ...asset,
                                  rawProofFile: proof.rawProofFile.replace(/\+/g, '-').replace(/\//g, '_')
                                });
                            }
                        }
                        console.log(assetsArr)
                        setAssets(assetsArr);
                    } catch (error) {
                        console.error("Error listing assets", error);
                        //setTimeout(checkAssetsReady, 10000);
                    }
                };

                checkAssetsReady();
            });

            const handleWindowClose = () => {
                newLnc.disconnect();
            };
            window.addEventListener('beforeunload', handleWindowClose);

            return () => {
                window.removeEventListener('beforeunload', handleWindowClose);
                newLnc.disconnect();
            };
        } else {
            setTaprootAssets(1);
        }
    };


    const handleStartGame = useCallback((event) => {
        event.preventDefault();
        let peerInstance = new Peer(nostrInfo.pk);
        /*
        if(!serverId){
            peerInstance = new Peer("testHubPeerJs")
        } else {
            peerInstance = new Peer(nostrInfo.pk);
        }
        */
        peerInstance.on('open',(id) => {
            console.log(`Initiated peerjs with id ${id}`)
            setPeer(peerInstance);
            setGameStarted(true);
        });
        return () => {
            peerInstance.destroy();
        };
    },[nostrInfo]);
    const handleEvent = useCallback(async (event) => {
      if(!nostrInfo || !relay ) return;
      const message = await nip04.decrypt(nostrInfo.sk,event.pubkey,event.content);
      console.log(message)
      if(message.startsWith("Invoice: ") && router){
        const invoice = JSON.parse(message.split("Invoice: ")[1]);
        console.log(invoice)
        console.log(lnd)
        console.log(await lnd.getInfo())
        router.SendPaymentV2({
          paymentRequest: invoice.payment_request,
          allowSelfPayment: true,
          feeLimitSat: 10,
          timeoutSeconds: 60,
          maxParts: 16
        },(msg) => {
          console.log(msg);
          if(msg.status === "SUCCEEDED"){
            // Generate taproot invoice, send to service with nostr and receive message about taproot invoice paid
          }
        },(err) => {
          console.error(err)
        });
      } else {
        try{
          setEvents(JSON.parse(message).assets)
        }catch(err){
          console.error(err)
        }
      };

    },[relay,nostrInfo,lnd,router]);
    const sendMessage = useCallback(async (message) => {
        if(!nostrInfo || !relay) return;
        if(message === "ListAssets"){
          console.log("Getting Assets from Market");
        }
        if(message.startsWith("BuyAsset: ")){
          console.log("Request to Buy Asset");
        }
        const ciphertext = await nip04.encrypt(nostrInfo.sk,marketPubKey,message);
        console.log(ciphertext);
        const signedEvent = finalizeEvent({
          kind: 4,
          pubkey: nostrInfo.pk,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['p',marketPubKey],
            ['t', 'catastrofic-instinct'],
          ],
          content: ciphertext
        }, nostrInfo.sk);
        let isGood = verifyEvent(signedEvent);
        console.log(`Event isGood: ${isGood}`)
        console.log(relay)
        if(!isGood) return;
        await relay.publish(signedEvent);
        console.log("published")
    },[nostrInfo,relay]);



    useEffect(() => {
      let sk
      if(localStorage.getItem('nostr-sk')){
        sk = new Uint8Array(localStorage.getItem('nostr-sk').split(","));
      } else {
        sk = generateSecretKey();
      }
      localStorage.setItem('nostr-sk',sk);
      let pk = getPublicKey(sk)
      let npub = nip19.npubEncode(pk)
      setNostrInfo({
        pk: pk,
        npub: npub,
        sk: sk
      });
      return;
    },[]);
    useEffect(() => {
        console.log(assets)
    },[assets])

    useEffect(() => {
        if (taprootAssets && assets && gameStarted && peer && nostrInfo) {
            const config = {
                type: Phaser.AUTO,
                width: 800,
                height: 600,
                physics: {
                    default: 'arcade',
                    arcade: {
                        debug: false
                    }
                },
                scene: new RTSGameScene({ taprootAssets,peer,assets,nostrInfo }),
                parent: gameContainer.current
            };
            const game = new Phaser.Game(config);

            return () => {
                game.destroy(true);
            };
        }
    }, [taprootAssets, gameStarted,peer,assets,nostrInfo]);

    useEffect(() => {
      if(!nostrInfo) return;
      Relay.connect('wss://relay1.nostrchat.io').then(async newRelay => {
        setRelay(newRelay);
      });
    },[nostrInfo]);
    useEffect(() => {
      if(!relay || !nostrInfo) return;
      // let's query for an event that exists
      const sub = relay.subscribe([
        {
          kinds: [4],
          since: Math.floor(Date.now() / 1000),
          '#p': [nostrInfo.pk],
        },
      ], {
        onevent(event) {
          console.log('we got the event we wanted:', event);
          handleEvent(event);
        },
        oneose() {
          console.log("Events Loaded");
        }
      });
      setTimeout(() => {
        sendMessage("ListAssets");
      },[1000])
      return () => {
        sub.close();
      };

    },[relay,nostrInfo,sendMessage,handleEvent])


    return (
        <div>
            {!gameStarted && (
                <>
                    <div>
                        <label>
                            LNC Pairing Phrase:
                            <input
                                type="text"
                                value={pairingPhrase}
                                onChange={(e) => setPairingPhrase(e.target.value)}
                                required
                            />
                        </label>
                        <button onClick={connectLNC}>LNC Connect</button>
                    </div>
                    <div>
                        <button onClick={handleStartGame}>Start Game</button>
                    </div>

                </>
            )}
            {gameStarted && (
                <div ref={gameContainer} style={{ width: '800px', height: '600px' }} />
            )}
            <div>
                {/*<p>Nostr npub: {nostrInfo?.npub}</p>*/}
                <p>Your peerId: {nostrInfo?.pk}</p>
                {
                    lndInfo &&
                    <>
                    <p>Connected LND as: {lndInfo.alias}</p>
                    <p>LND pubkey: {lndInfo.identityPubkey}</p>
                    {
                    assets?.length > 0 ?
                    assets.map(item => {
                        return(
                            <div key={item.assetGenesis.id}>
                                <p><b>Name: {item.assetGenesis.name}</b></p>
                                <p>Type: {item.assetGenesis.assetType}</p>
                                <p>Amount: {item.amount}</p>
                                {
                                    item.assetGenesis.assetType === "COLLECTIBLE" &&
                                    <div>
                                        <p>Data</p>
                                        <img src={item.decodedMeta} alt="" style={{width: "200px"}}/>
                                    </div>
                                }
                            </div>
                        );
                    }) :
                    <p>No TaptootAssets found</p>
                    }
                    </>

                }
                {
                  nostrInfo &&
                  <div>
                  {
                    events &&
                    <h4>Taproot Assets Game Market</h4>
                  }
                  {
                    events?.map(item => {
                      return(
                        <div style={{overflowX: "auto"}} key={item.asset_genesis.asset_id}>
                          <p>Name: {item.asset_genesis.name}</p>
                          <p>Available: {item.amount}</p>
                          <p>Id: {item.asset_genesis.asset_id}</p>
                          <div>
                            {
                              lndInfo &&
                              <button onClick={() => {
                                const message = `BuyAsset: ${JSON.stringify({
                                  id: item.asset_genesis.asset_id,
                                  amount: 10
                                })}`;
                                console.log(message)
                                sendMessage(message);
                              }}>Buy</button>
                            }
                          </div>
                        </div>
                      );
                    })
                  }
                  </div>
                }
            </div>
        </div>
    );
};

export default PhaserGame;
