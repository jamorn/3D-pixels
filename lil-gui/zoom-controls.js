export function addZoomControls(gui, params, callbacks = {}) {
    const zoomFolder = gui.addFolder('Zoom');

    zoomFolder.add(params, 'zoomEnabled').name('Enable Zoom').onChange(v => {
        if (!v) {
            // if disabling, reset to default
            if (typeof callbacks.reset === 'function') callbacks.reset();
        }
    });

    zoomFolder.add(params, 'zoomFactor', 1.0, 8.0, 0.1).name('Zoom Factor').onChange(() => {
        if (typeof callbacks.apply === 'function') callbacks.apply();
    });

    zoomFolder.add(params, 'zoomCenterX', -0.5, 0.5, 0.01).name('Center X (%)').onChange(() => {
        if (typeof callbacks.apply === 'function') callbacks.apply();
    });
    zoomFolder.add(params, 'zoomCenterY', -0.5, 0.5, 0.01).name('Center Y (%)').onChange(() => {
        if (typeof callbacks.apply === 'function') callbacks.apply();
    });

    const api = {
        Apply: () => { if (typeof callbacks.apply === 'function') callbacks.apply(); },
        Reset: () => { if (typeof callbacks.reset === 'function') callbacks.reset(); }
    };
    zoomFolder.add(api, 'Apply').name('Apply Zoom');
    zoomFolder.add(api, 'Reset').name('Reset Zoom');

    zoomFolder.open();
}
