// @ts-nocheckk
import { firestore } from './src/firebase'
import './style.css'

import { collection, doc, getDoc, setDoc, onSnapshot, addDoc, updateDoc } from 'firebase/firestore'

document.querySelector('#app').innerHTML = `
  <div>
    <h2>1. Start your Webcam</h2>
    <div class="videos">
      <span>
        <h3>Local Stream</h3>
        <video id="webcamVideo" autoplay playsinline></video>
      </span>
      <span>
        <h3>Remote Stream</h3>
        <video id="remoteVideo" autoplay playsinline></video>
      </span>
    </div>

    <button id="webcamButton">Start webcam</button>
    <h2>2. Create a new Call</h2>
    <button id="callButton" disabled>Create Call (offer)</button>

    <h2>3. Join a Call</h2>
    <p>Answer the call from a different browser window or device</p>
    
    <input id="callInput" />
    <button id="answerButton" disabled>Answer</button>

    <h2>4. Hangup</h2>

    <button id="hangupButton" disabled>Hangup</button>
  </div>
`

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
}

let pc = new RTCPeerConnection(servers)

let localStream = null // my webcam
let remoteStream = null // friend webcam

// HTML elements
const webcamButton = document.getElementById('webcamButton')
const webcamVideo = document.getElementById('webcamVideo')
const callButton = document.getElementById('callButton')
const callInput = document.getElementById('callInput')
const answerButton = document.getElementById('answerButton')
const remoteVideo = document.getElementById('remoteVideo')
const hangupButton = document.getElementById('hangupButton')

// 1. Setup media sources

webcamButton.onclick = async () => {
  // 네비게이터 미디어 장치가 getUserMedia를 기다리면 video, audio를 설정하면 대화상자가 나타나면서 웹캠에 엑세스할 권한을 묻고 부여합니다.
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  // 이후 MediaStream 객체로 resolve하는 Promise를 반환합니다.
  remoteStream = new MediaStream()

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream)
  })

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track)
    })
  }

  webcamVideo.srcObject = localStream
  remoteVideo.srcObject = remoteStream

  callButton.disabled = false
  answerButton.disabled = false
  webcamButton.disabled = true
}

const callCollection = collection(firestore, 'calls')

// 2. Create an offer
callButton.onclick = async () => {
  const callDoc = doc(callCollection)

  const offerCandidates = collection(callDoc, 'offerCandidates')
  const answerCandidates = collection(callDoc, 'answerCandidates')

  callInput.value = callDoc.id

  // Get candidates for caller, save to db
  pc.onicecandidate = event => {
    event.candidate && addDoc(offerCandidates, event.candidate.toJSON())
  }

  // Create offer
  const offerDescription = await pc.createOffer()
  await pc.setLocalDescription(offerDescription)

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  }

  await setDoc(callDoc, { offer })

  // Listen for remote answer
  onSnapshot(callDoc, snapshot => {
    const data = snapshot.data()
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer)
      pc.setRemoteDescription(answerDescription)
    }
  })

  // When answered, add candidate to peer connection
  onSnapshot(answerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data())
        pc.addIceCandidate(candidate)
      }
    })
  })

  hangupButton.disabled = false
}

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value
  const callDoc = doc(callCollection, callId)

  const answerCandidates = collection(callDoc, 'answerCandidates')
  const offerCandidates = collection(callDoc, 'offerCandidates')

  pc.onicecandidate = event => {
    event.candidate && addDoc(answerCandidates, event.candidate.toJSON())
  }

  const callData = (await getDoc(callDoc)).data()

  const offerDescription = callData.offer
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription))

  const answerDescription = await pc.createAnswer()
  await pc.setLocalDescription(answerDescription)

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  }

  await updateDoc(callDoc, { answer })

  onSnapshot(offerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      console.log(change)
      if (change.type === 'added') {
        let data = change.doc.data()
        pc.addIceCandidate(new RTCIceCandidate(data))
      }
    })
  })
}
