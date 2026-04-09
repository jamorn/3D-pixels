export function addWaveControls(gui, params) {
    const waveFolder = gui.addFolder('Wave');
    waveFolder.add(params, 'waveEnabled').name('Enable Wave');
    waveFolder.add(params, 'waveAmplitude', 0, 10, 0.1).name('Amplitude');
    waveFolder.add(params, 'waveFrequency', 0.005, 0.5, 0.005).name('Spatial Frequency');
    waveFolder.add(params, 'waveSpeed', 0, 5, 0.05).name('Speed');
    waveFolder.open();
}
