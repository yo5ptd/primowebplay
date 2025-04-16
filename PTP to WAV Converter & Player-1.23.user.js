// ==UserScript==
// @name         PTP to WAV Converter & Player
// @namespace    http://tampermonkey.net/
// @version      1.23
// @description  Converts .PTP files to 8-bit mono 8000Hz WAV and adds play/download buttons
// @author       YO5PTD
// @match        http://primo.homeserver.hu/*
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    const SILENCE = 128;
    const POS_PEAK = 248;
    const NEG_PEAK = 8;

    const sampleRate = 8000;

    function createWavHeader(dataLength) {
        // Corresponds to header generation
        const buffer = new ArrayBuffer(44);
        const view = new DataView(buffer);

        function writeString(offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 1, true);
        view.setUint16(32, 1, true);
        view.setUint16(34, 8, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        return new Uint8Array(buffer);
    }

    function byteToBits(byte) {
        if (typeof byte !== 'number') throw new Error('Invalid byte');
        return byte.toString(2).padStart(8, '0').split('').map(Number);
    }

    function writeBit(bit, output) {
        // Pascal: procedure BIT0 and BIT1
        if (bit === 0) {
            for (let i = 0; i < 8; i++) output.push(POS_PEAK);
            for (let i = 0; i < 8; i++) output.push(NEG_PEAK);
        } else {
            for (let i = 0; i < 3; i++) output.push(POS_PEAK);
            for (let i = 0; i < 3; i++) output.push(NEG_PEAK);
        }
    }

    function writeByte(byte, output) {
        // Pascal: procedure IRAS
        if (typeof byte !== 'number') throw new Error('writeByte got invalid byte');
        byteToBits(byte).forEach(bit => writeBit(bit, output));
    }

    function writeSilence(output, count = 2000) {
        // Pascal: feltételezett néma szakasz
        for (let i = 0; i < count; i++) output.push(SILENCE);
    }

    function writeFileSync(output) {
        // Pascal: procedure FSYNC
        for (let i = 0; i < 512; i++) writeByte(0xAA, output);
    }

    function writeBlockSync(output) {
        // Pascal: procedure BSYNC
        for (let i = 0; i < 96; i++) writeByte(0xFF, output);
        for (let i = 0; i < 3; i++) writeByte(0xD3, output);
    }

    async function fetchPTP(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch PTP file: ${url}`);
        const buffer = await response.arrayBuffer();
        console.debug(`Fetched ${buffer.byteLength} bytes from ${url}`);
        return new Uint8Array(buffer);
    }

    async function convertPTPtoWAV(ptpData) {
        const audioData = [];
        writeSilence(audioData); // Pascal: initial silence
        writeFileSync(audioData); // Pascal: FSYNC

        let pos = 3; // Pascal: dec (3)
        let blockIndex = 1;

        console.debug(`File size: ${ptpData.length-3}`);
        while (pos+3 < ptpData.length) {
            const id = ptpData[pos];
            if (id !== 0x55 && id !== 0xAA) {
                          console.warn('Aborting: block id error.');
                          break; // Prevent overflow
            }
            const len = ptpData[pos + 1] + ptpData[pos + 2] * 256;
            if (len === 0) {
                console.warn(`Block ${blockIndex} has zero length, skipping...`);
            }
            console.debug(`Block ${blockIndex}: ID=${id.toString(16)}, LEN=${len}`);

            writeBlockSync(audioData); // Pascal: BSYNC
            for (let i = 0; i < len; i++) writeByte(ptpData[pos + i + 3], audioData);

            pos += len+3;
            blockIndex++;
        }

        console.debug(`Total samples: ${audioData.length}, Duration: ${audioData.length / sampleRate}s`);
        writeSilence(audioData, 1000); // Pascal: trailing silence

        const wavHeader = createWavHeader(audioData.length);
        return new Uint8Array([...wavHeader, ...audioData]);
    }

    function addButtons(link) {
        const container = document.createElement('span');
        container.style.marginLeft = '10px';

        const playBtn = document.createElement('button');
        playBtn.textContent = '▶️';

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '💾';

        let audio = null;
        let audioUrl = null;

        playBtn.onclick = async () => {
            if (audio && !audio.paused) {
                audio.pause();
                playBtn.textContent = '▶️';
                return;
            }

            try {
                const ptpData = await fetchPTP(link.href);
                const wav = await convertPTPtoWAV(ptpData);

                if (audioUrl) URL.revokeObjectURL(audioUrl);
                audioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
                audio = new Audio(audioUrl);
                audio.play();
                playBtn.textContent = '⏹️';
                audio.onended = () => playBtn.textContent = '▶️';
            } catch (err) {
                console.error('Failed to play audio:', err);
            }
        };

        downloadBtn.onclick = async () => {
            try {
                const ptpData = await fetchPTP(link.href);
                const wav = await convertPTPtoWAV(ptpData);
                const blob = new Blob([wav], { type: 'audio/wav' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                const filename = link.href.split('/').pop().replace(/\.ptp$/i, '.wav');
                a.download = filename;
                a.click();
            } catch (err) {
                console.error('Failed to download audio:', err);
            }
        };

        container.appendChild(playBtn);
        container.appendChild(downloadBtn);
        link.parentElement.appendChild(container);
    }
    document.querySelectorAll('p > a[href$=".ptp"]').forEach(addButtons);
})();
