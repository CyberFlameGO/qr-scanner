class QrScannerLib {
    constructor(video, canvas, onDecode) {
        this.$video = video;
        this.$canvas = canvas;
        this.$context = this.$canvas.getContext('2d', { alpha: false });
        this.$context.imageSmoothingEnabled = false; // gives less blurry images
        this._canvasSize = this.$canvas.width;
        this._sourceRectSize = this._canvasSize;

        this._onDecode = onDecode;

        window.addEventListener('resize', () => this._updateSourceRect());
        this.$video.addEventListener('canplay', () => this._updateSourceRect());
        this.$video.addEventListener('play', () => this._scanFrame(), false);
        this._qrWorker = new Worker('/qr-scanner/qr-scanner-worker.min.js');
        this._qrWorker.addEventListener('message', event => this._handleWorkerMessage(event));
    }

    _updateSourceRect() {
        const smallestDimension = Math.min(this.$video.videoWidth, this.$video.videoHeight);
        this._sourceRectSize = Math.round(2 / 3 * smallestDimension);
    }

    _scanFrame() {
        if (this.$video.paused || this.$video.ended) return false;
        const x0 = (this.$video.videoWidth - this._sourceRectSize) / 2;
        const y0 = (this.$video.videoHeight - this._sourceRectSize) / 2;
        this.$context.drawImage(this.$video, x0, y0, this._sourceRectSize, this._sourceRectSize, 0, 0, this._canvasSize, this._canvasSize);
        const imageData = this.$context.getImageData(0, 0, this._canvasSize, this._canvasSize);
        this._qrWorker.postMessage({
            type: 'decode',
            data: imageData
        }, [imageData.data.buffer]);
    }

    _handleWorkerMessage(event) {
        const type = event.data.type;
        const data = event.data.data;
        if (type !== 'qrResult') return;
        requestAnimationFrame(() => this._scanFrame());

        if (data === null) return;
        this._onDecode(data);
    }

    set active(active) {
        if (active)
            this._cameraOn();
        else
            this._cameraOff();
    }

    _cameraOn(settingsToTry) {
        clearTimeout(this._offTimeout);
        const defaultSettings = [{
            facingMode: "environment",
            width: { min: 1024 }
        }, {
            facingMode: "environment",
            width: { min: 768 }
        }, {
            facingMode: "environment",
        }];
        settingsToTry = settingsToTry || defaultSettings;
        navigator.mediaDevices.getUserMedia({
                video: settingsToTry.shift()
            })
            .then(stream => this.$video.srcObject = stream)
            .catch(() => {
                if (settingsToTry.length > 0) {
                    this._cameraOn(settingsToTry)
                } else {
                    throw new Error('Couldn\'t start camera');
                }
            });
    }

    _cameraOff() {
        this.$video.pause();
        this._offTimeout = setTimeout(() => this.$video.srcObject.getTracks()[0].stop(), 3000);
    }

    setGrayscaleWeights(red, green, blue) {
        this._qrWorker.postMessage({
            type: 'grayscaleWeights',
            data: { red, green, blue }
        });
    }

    static scanImage(imageOrFileOrUrl) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(reject, 3000);
            const worker = new Worker('/qr-scanner/qr-scanner-worker.min.js');
            worker.onerror = reject;
            worker.onmessage = event => {
                if (event.data.type !== 'qrResult') {
                    return;
                }
                clearTimeout(timeout);
                if (event.data.data !== null) {
                    resolve(event.data.data);
                } else {
                    reject();
                }
            };
            QrScannerLib._loadImage(imageOrFileOrUrl).then(image => {
                const imageData = QrScannerLib._getImageData(image);
                worker.postMessage({
                    type: 'decode',
                    data: imageData
                }, [imageData.data.buffer]);
            }).catch(reject);
        });
    }

    /* async */
    static _getImageData(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
    }

    /* async */
    static _loadImage(imageOrFileOrUrl) {
        if (imageOrFileOrUrl instanceof HTMLCanvasElement
            || typeof('ImageBitmap')!=='undefined' && imageOrFileOrUrl instanceof ImageBitmap) {
            return Promise.resolve(imageOrFileOrUrl);
        } else if (imageOrFileOrUrl instanceof Image) {
            return QrScannerLib._awaitImageLoad(imageOrFileOrUrl).then(() => imageOrFileOrUrl);
        } else if (imageOrFileOrUrl instanceof File || imageOrFileOrUrl instanceof URL
            ||  typeof(imageOrFileOrUrl)==='string') {
            const image = new Image();
            if (imageOrFileOrUrl instanceof File) {
                image.src = URL.createObjectURL(imageOrFileOrUrl);
            } else {
                image.src = imageOrFileOrUrl;
            }
            return QrScannerLib._awaitImageLoad(image).then(() => {
                if (imageOrFileOrUrl instanceof File) {
                    URL.revokeObjectURL(image.src);
                }
                return image;
            });
        } else {
            return Promise.reject('Unsupported image type.');
        }
    }

    /* async */
    static _awaitImageLoad(image) {
        return new Promise((resolve, reject) => {
            if (image.complete && image.naturalWidth!==0) {
                // already loaded
                resolve();
            } else {
                image.onload = () => {
                    image.onload = null;
                    image.onerror = null;
                    resolve();
                };
                image.onerror = () => {
                    image.onload = null;
                    image.onerror = null;
                    reject();
                };
            }
        });
    }
}