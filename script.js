"use strict";

// =========================================================
// START AUFGABE 10: Seeds-Daten in 3D
// =========================================================

const EINSTELLUNGEN = {
    dimensionen: 3,
    perplexity: 40,
    epsilon: 10,
    gespeicherteIterationen: 1000
};

let gl;
let shaderProgramm;

let punktPositionsBuffer;
let punktFarbenBuffer;
let rasterPositionsBuffer;
let rasterFarbenBuffer;

let anzahlPunkte = 0;
let anzahlRasterVertices = 0;

let originalDaten = [];
let standardisierteDaten = [];
let klassen = [];
let aktuellePositionen = [];

let tsne = null;
let schrittzahl = 0;
let berechnungGestartet = false;

let rotationX = -0.28;
let rotationY = 0.55;
let kameraAbstand = 9.0;

const canvas = document.getElementById("glcanvas");
const statusmeldung = document.getElementById("statusmeldung");
const schrittAnzeige = document.getElementById("step-count");
const kameraStatus = document.getElementById("kamera-status");


// ---------------------------------------------------------
// Kleine Matrixfunktionen für die 3D-Darstellung
// ---------------------------------------------------------

function einheitsmatrix() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
}

function matrizenMultiplizieren(a, b) {
    const ergebnis = new Float32Array(16);

    for (let spalte = 0; spalte < 4; spalte += 1) {
        for (let zeile = 0; zeile < 4; zeile += 1) {
            let wert = 0;

            for (let k = 0; k < 4; k += 1) {
                wert += a[k * 4 + zeile] * b[spalte * 4 + k];
            }

            ergebnis[spalte * 4 + zeile] = wert;
        }
    }

    return ergebnis;
}

function perspektivmatrix(fov, seitenverhaeltnis, nah, fern) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (nah - fern);

    return new Float32Array([
        f / seitenverhaeltnis, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (fern + nah) * nf, -1,
        0, 0, 2 * fern * nah * nf, 0
    ]);
}

function verschiebungsmatrix(x, y, z) {
    const matrix = einheitsmatrix();

    matrix[12] = x;
    matrix[13] = y;
    matrix[14] = z;

    return matrix;
}

function rotationsmatrixX(winkel) {
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);

    return new Float32Array([
        1, 0, 0, 0,
        0, c, s, 0,
        0, -s, c, 0,
        0, 0, 0, 1
    ]);
}

function rotationsmatrixY(winkel) {
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);

    return new Float32Array([
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1
    ]);
}


// ---------------------------------------------------------
// Shader erzeugen
// ---------------------------------------------------------

function shaderErstellen(typ, quelltext) {
    const shader = gl.createShader(typ);

    gl.shaderSource(shader, quelltext);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const meldung = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);

        throw new Error(
            "Der WebGL-Shader konnte nicht kompiliert werden: "
            + meldung
        );
    }

    return shader;
}


// ---------------------------------------------------------
// WebGL vorbereiten
// ---------------------------------------------------------

function webglVorbereiten() {
    gl = canvas.getContext("webgl", {
        antialias: true,
        alpha: false
    });

    if (!gl) {
        throw new Error(
            "WebGL wird von diesem Browser nicht unterstützt."
        );
    }

    const vertexShaderText = `
        attribute vec3 aPosition;
        attribute vec3 aColor;

        uniform mat4 uMvpMatrix;
        uniform float uPointSize;

        varying vec3 vColor;

        void main(void) {
            gl_Position = uMvpMatrix * vec4(aPosition, 1.0);
            gl_PointSize = uPointSize;
            vColor = aColor;
        }
    `;

    const fragmentShaderText = `
        precision mediump float;

        uniform float uPunktDarstellung;

        varying vec3 vColor;

        void main(void) {
            if (uPunktDarstellung > 0.5) {
                vec2 abstand = gl_PointCoord - vec2(0.5);

                if (length(abstand) > 0.5) {
                    discard;
                }

                float licht = 1.0 - 0.35 * length(abstand);
                gl_FragColor = vec4(vColor * licht, 1.0);
            } else {
                gl_FragColor = vec4(vColor, 0.72);
            }
        }
    `;

    const vertexShader = shaderErstellen(
        gl.VERTEX_SHADER,
        vertexShaderText
    );

    const fragmentShader = shaderErstellen(
        gl.FRAGMENT_SHADER,
        fragmentShaderText
    );

    shaderProgramm = gl.createProgram();

    gl.attachShader(shaderProgramm, vertexShader);
    gl.attachShader(shaderProgramm, fragmentShader);
    gl.linkProgram(shaderProgramm);

    if (!gl.getProgramParameter(
        shaderProgramm,
        gl.LINK_STATUS
    )) {
        throw new Error(
            "Das WebGL-Programm konnte nicht verknüpft werden: "
            + gl.getProgramInfoLog(shaderProgramm)
        );
    }

    shaderProgramm.aPosition = gl.getAttribLocation(
        shaderProgramm,
        "aPosition"
    );

    shaderProgramm.aColor = gl.getAttribLocation(
        shaderProgramm,
        "aColor"
    );

    shaderProgramm.uMvpMatrix = gl.getUniformLocation(
        shaderProgramm,
        "uMvpMatrix"
    );

    shaderProgramm.uPointSize = gl.getUniformLocation(
        shaderProgramm,
        "uPointSize"
    );

    shaderProgramm.uPunktDarstellung = gl.getUniformLocation(
        shaderProgramm,
        "uPunktDarstellung"
    );

    punktPositionsBuffer = gl.createBuffer();
    punktFarbenBuffer = gl.createBuffer();
    rasterPositionsBuffer = gl.createBuffer();
    rasterFarbenBuffer = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    gl.blendFunc(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA
    );

    rasterErstellen();
}


// ---------------------------------------------------------
// Bodenraster als räumliche Orientierung
// ---------------------------------------------------------

function rasterErstellen() {
    const positionen = [];
    const farben = [];

    const rasterFarbe = [
        0.31,
        0.63,
        0.67
    ];

    for (let wert = -3; wert <= 3.001; wert += 0.5) {
        positionen.push(
            -3, -2.55, wert,
            3, -2.55, wert
        );

        positionen.push(
            wert, -2.55, -3,
            wert, -2.55, 3
        );

        for (let index = 0; index < 4; index += 1) {
            farben.push(...rasterFarbe);
        }
    }

    anzahlRasterVertices = positionen.length / 3;

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        rasterPositionsBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(positionen),
        gl.STATIC_DRAW
    );

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        rasterFarbenBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(farben),
        gl.STATIC_DRAW
    );
}


// ---------------------------------------------------------
// Textdatei über den lokalen Webserver laden
// ---------------------------------------------------------

async function textdateiLaden(pfad) {
    const antwort = await fetch(pfad);

    if (!antwort.ok) {
        throw new Error(
            `${pfad} konnte nicht geladen werden.`
        );
    }

    return antwort.text();
}


// ---------------------------------------------------------
// Seeds-Datensatz einlesen
// ---------------------------------------------------------

async function seedsDatenLaden() {
    if (typeof Papa === "undefined") {
        throw new Error(
            "Papa Parse konnte nicht geladen werden."
        );
    }

    const csvText = await textdateiLaden(
        "data/Seeds_dataset.csv"
    );

    const ergebnis = Papa.parse(csvText, {
        delimiter: ",",
        dynamicTyping: true,
        skipEmptyLines: true
    });

    if (ergebnis.errors.length > 0) {
        console.warn(
            "Hinweise von Papa Parse:",
            ergebnis.errors
        );
    }

    const gueltigeZeilen = ergebnis.data.filter(
        (zeile) => {
            return Array.isArray(zeile)
                && zeile.length === 8
                && zeile.every(
                    (wert) => Number.isFinite(wert)
                );
        }
    );

    if (gueltigeZeilen.length !== 210) {
        throw new Error(
            `Es wurden ${gueltigeZeilen.length} statt `
            + "210 Datensätzen gelesen."
        );
    }

    originalDaten = gueltigeZeilen.map(
        (zeile) => zeile.slice(0, 7)
    );

    klassen = gueltigeZeilen.map(
        (zeile) => Number(zeile[7])
    );

    standardisierteDaten = datenStandardisieren(
        originalDaten
    );

    document.getElementById(
        "datensatz-anzeige"
    ).textContent = String(originalDaten.length);
}


// ---------------------------------------------------------
// Merkmale standardisieren
// ---------------------------------------------------------

function datenStandardisieren(daten) {
    const spaltenzahl = daten[0].length;

    const mittelwerte = new Array(
        spaltenzahl
    ).fill(0);

    const standardabweichungen = new Array(
        spaltenzahl
    ).fill(0);

    daten.forEach((zeile) => {
        zeile.forEach((wert, index) => {
            mittelwerte[index] += wert;
        });
    });

    for (
        let index = 0;
        index < spaltenzahl;
        index += 1
    ) {
        mittelwerte[index] /= daten.length;
    }

    daten.forEach((zeile) => {
        zeile.forEach((wert, index) => {
            const differenz =
                wert - mittelwerte[index];

            standardabweichungen[index] +=
                differenz * differenz;
        });
    });

    for (
        let index = 0;
        index < spaltenzahl;
        index += 1
    ) {
        standardabweichungen[index] = Math.sqrt(
            standardabweichungen[index]
            / daten.length
        );
    }

    return daten.map((zeile) => {
        return zeile.map((wert, index) => {
            const streuung =
                standardabweichungen[index] || 1;

            return (
                wert - mittelwerte[index]
            ) / streuung;
        });
    });
}


// ---------------------------------------------------------
// Gespeichertes bestes t-SNE-Ergebnis einlesen
// ---------------------------------------------------------

async function gespeichertesErgebnisLaden() {
    const csvText = await textdateiLaden(
        "data/seeds_best.csv"
    );

    const ergebnis = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    });

    const zeilen = ergebnis.data.filter(
        (zeile) => {
            return Number.isFinite(zeile.x)
                && Number.isFinite(zeile.y)
                && Number.isFinite(zeile.z)
                && Number.isFinite(zeile.class);
        }
    );

    if (zeilen.length !== 210) {
        throw new Error(
            "Das gespeicherte Ergebnis enthält "
            + "nicht 210 Punkte."
        );
    }

    aktuellePositionen = zeilen.map(
        (zeile) => [
            zeile.x,
            zeile.y,
            zeile.z
        ]
    );

    klassen = zeilen.map(
        (zeile) => Number(zeile.class)
    );

    schrittzahl =
        EINSTELLUNGEN.gespeicherteIterationen;

    berechnungGestartet = false;

    positionenAnWebGLUebergeben(
        aktuellePositionen
    );

    schrittAnzeige.textContent =
        `${schrittzahl} (gespeichertes Ergebnis)`;

    statusSetzen(
        "Das gespeicherte beste "
        + "t-SNE-Ergebnis wurde geladen."
    );
}


// ---------------------------------------------------------
// Eine neue t-SNE-Berechnung beginnen
// ---------------------------------------------------------

function tsneNeuStarten() {
    if (typeof tsnejs === "undefined") {
        statusSetzen(
            "tSNEJS konnte nicht geladen werden.",
            true
        );

        return;
    }

    if (standardisierteDaten.length === 0) {
        statusSetzen(
            "Die Seeds-Daten sind noch nicht geladen.",
            true
        );

        return;
    }

    tsne = new tsnejs.tSNE({
        dim: EINSTELLUNGEN.dimensionen,
        perplexity: EINSTELLUNGEN.perplexity,
        epsilon: EINSTELLUNGEN.epsilon
    });

    tsne.initDataRaw(standardisierteDaten);

    schrittzahl = 0;
    berechnungGestartet = true;

    aktuellePositionen = tsne.getSolution();

    positionenAnWebGLUebergeben(
        aktuellePositionen
    );

    schrittAnzeige.textContent = "0";

    statusSetzen(
        "Neue zufällige Ausgangsverteilung: "
        + "t-SNE beginnt bei Schritt 0."
    );
}


// ---------------------------------------------------------
// Einen oder zehn t-SNE-Schritte ausführen
// ---------------------------------------------------------

function tsneSchritteAusfuehren(anzahl) {
    if (!berechnungGestartet || !tsne) {
        tsneNeuStarten();
    }

    if (!tsne) {
        return;
    }

    for (
        let index = 0;
        index < anzahl;
        index += 1
    ) {
        tsne.step();
    }

    schrittzahl += anzahl;

    aktuellePositionen = tsne.getSolution();

    positionenAnWebGLUebergeben(
        aktuellePositionen
    );

    schrittAnzeige.textContent =
        String(schrittzahl);

    const mehrzahl =
        anzahl === 1 ? "" : "e";

    statusSetzen(
        `${anzahl} t-SNE-Schritt${mehrzahl} ausgeführt.`
    );
}


// ---------------------------------------------------------
// Positionen für die 3D-Darstellung normalisieren
// ---------------------------------------------------------

function positionenNormalisieren(positionen) {
    const mittelpunkt = [0, 0, 0];

    positionen.forEach((punkt) => {
        mittelpunkt[0] += punkt[0];
        mittelpunkt[1] += punkt[1];
        mittelpunkt[2] += punkt[2];
    });

    mittelpunkt[0] /= positionen.length;
    mittelpunkt[1] /= positionen.length;
    mittelpunkt[2] /= positionen.length;

    let groessterAbstand = 0;

    positionen.forEach((punkt) => {
        for (
            let achse = 0;
            achse < 3;
            achse += 1
        ) {
            const abstand = Math.abs(
                punkt[achse] - mittelpunkt[achse]
            );

            groessterAbstand = Math.max(
                groessterAbstand,
                abstand
            );
        }
    });

    const skalierung =
        groessterAbstand > 0
            ? 2.35 / groessterAbstand
            : 1;

    return positionen.map((punkt) => [
        (punkt[0] - mittelpunkt[0]) * skalierung,
        (punkt[1] - mittelpunkt[1]) * skalierung,
        (punkt[2] - mittelpunkt[2]) * skalierung
    ]);
}


// ---------------------------------------------------------
// Farbe anhand der Weizenklasse auswählen
// ---------------------------------------------------------

function farbeFuerKlasse(klasse) {
    if (klasse === 1) {
        // Kama: Türkis
        return [0.17, 0.67, 0.66];
    }

    if (klasse === 2) {
        // Rosa: Rosaton
        return [0.90, 0.43, 0.56];
    }

    // Canadian: Orange
    return [0.95, 0.51, 0.16];
}


// ---------------------------------------------------------
// Datenpunkte an WebGL übertragen
// ---------------------------------------------------------

function positionenAnWebGLUebergeben(positionen) {
    if (!positionen || positionen.length === 0) {
        return;
    }

    const normalisiertePositionen =
        positionenNormalisieren(positionen);

    const flachePositionen =
        normalisiertePositionen.flat();

    const flacheFarben = [];

    klassen.forEach((klasse) => {
        flacheFarben.push(
            ...farbeFuerKlasse(klasse)
        );
    });

    anzahlPunkte =
        normalisiertePositionen.length;

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        punktPositionsBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(flachePositionen),
        gl.DYNAMIC_DRAW
    );

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        punktFarbenBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(flacheFarben),
        gl.STATIC_DRAW
    );

    zeichnen();
}


// ---------------------------------------------------------
// Canvas an die tatsächliche Anzeigegröße anpassen
// ---------------------------------------------------------

function canvasAnpassen() {
    const pixelFaktor = Math.min(
        window.devicePixelRatio || 1,
        2
    );

    const breite = Math.round(
        canvas.clientWidth * pixelFaktor
    );

    const hoehe = Math.round(
        canvas.clientHeight * pixelFaktor
    );

    if (
        canvas.width !== breite
        || canvas.height !== hoehe
    ) {
        canvas.width = breite;
        canvas.height = hoehe;
    }
}


// ---------------------------------------------------------
// WebGL-Attribute aktivieren
// ---------------------------------------------------------

function attributeAktivieren(
    positionBuffer,
    farbBuffer
) {
    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        positionBuffer
    );

    gl.vertexAttribPointer(
        shaderProgramm.aPosition,
        3,
        gl.FLOAT,
        false,
        0,
        0
    );

    gl.enableVertexAttribArray(
        shaderProgramm.aPosition
    );

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        farbBuffer
    );

    gl.vertexAttribPointer(
        shaderProgramm.aColor,
        3,
        gl.FLOAT,
        false,
        0,
        0
    );

    gl.enableVertexAttribArray(
        shaderProgramm.aColor
    );
}


// ---------------------------------------------------------
// Szene zeichnen
// ---------------------------------------------------------

function zeichnen() {
    if (!gl || !shaderProgramm) {
        return;
    }

    canvasAnpassen();

    gl.viewport(
        0,
        0,
        canvas.width,
        canvas.height
    );

    gl.clearColor(
        0.82,
        0.94,
        0.95,
        1.0
    );

    gl.clear(
        gl.COLOR_BUFFER_BIT
        | gl.DEPTH_BUFFER_BIT
    );

    gl.useProgram(shaderProgramm);

    const projektion = perspektivmatrix(
        Math.PI / 4,
        canvas.width / canvas.height,
        0.1,
        100
    );

    let ansicht = verschiebungsmatrix(
        0,
        0,
        -kameraAbstand
    );

    ansicht = matrizenMultiplizieren(
        ansicht,
        rotationsmatrixX(rotationX)
    );

    ansicht = matrizenMultiplizieren(
        ansicht,
        rotationsmatrixY(rotationY)
    );

    const mvpMatrix =
        matrizenMultiplizieren(
            projektion,
            ansicht
        );

    gl.uniformMatrix4fv(
        shaderProgramm.uMvpMatrix,
        false,
        mvpMatrix
    );

    // Bodenraster zeichnen

    attributeAktivieren(
        rasterPositionsBuffer,
        rasterFarbenBuffer
    );

    gl.uniform1f(
        shaderProgramm.uPointSize,
        1
    );

    gl.uniform1f(
        shaderProgramm.uPunktDarstellung,
        0
    );

    gl.drawArrays(
        gl.LINES,
        0,
        anzahlRasterVertices
    );

    // Seeds-Datenpunkte zeichnen

    if (anzahlPunkte > 0) {
        attributeAktivieren(
            punktPositionsBuffer,
            punktFarbenBuffer
        );

        const punktgroesse = Math.max(
            8,
            13 * Math.min(
                window.devicePixelRatio || 1,
                2
            )
        );

        gl.uniform1f(
            shaderProgramm.uPointSize,
            punktgroesse
        );

        gl.uniform1f(
            shaderProgramm.uPunktDarstellung,
            1
        );

        gl.drawArrays(
            gl.POINTS,
            0,
            anzahlPunkte
        );
    }
}


// ---------------------------------------------------------
// Kameraanzeige aktualisieren
// ---------------------------------------------------------

function kameraStatusAktualisieren() {
    const winkelX = Math.round(
        rotationX * 180 / Math.PI
    );

    const winkelY = Math.round(
        rotationY * 180 / Math.PI
    );

    kameraStatus.textContent =
        `Kamera: Drehung X ${winkelX}°, `
        + `Y ${winkelY}°, `
        + `Abstand ${kameraAbstand.toFixed(1)}`;
}


// ---------------------------------------------------------
// Ansicht drehen
// ---------------------------------------------------------

function ansichtDrehen(deltaX, deltaY) {
    rotationX += deltaX;
    rotationY += deltaY;

    kameraStatusAktualisieren();
    zeichnen();
}


// ---------------------------------------------------------
// Kameraabstand ändern
// ---------------------------------------------------------

function kameraAbstandAendern(delta) {
    kameraAbstand = Math.max(
        5.5,
        Math.min(
            15,
            kameraAbstand + delta
        )
    );

    kameraStatusAktualisieren();
    zeichnen();
}


// ---------------------------------------------------------
// Ansicht zurücksetzen
// ---------------------------------------------------------

function ansichtZuruecksetzen() {
    rotationX = -0.28;
    rotationY = 0.55;
    kameraAbstand = 9.0;

    kameraStatus.textContent =
        "Kamera: Ausgangsposition";

    zeichnen();
}


// ---------------------------------------------------------
// Statusmeldung auf der Seite anzeigen
// ---------------------------------------------------------

function statusSetzen(text, istFehler = false) {
    statusmeldung.textContent = text;

    statusmeldung.classList.toggle(
        "fehler",
        istFehler
    );
}


// ---------------------------------------------------------
// Buttons und Tastatursteuerung
// ---------------------------------------------------------

function bedienungVorbereiten() {
    document.getElementById(
        "restart-button"
    ).addEventListener(
        "click",
        tsneNeuStarten
    );

    document.getElementById(
        "step-button"
    ).addEventListener(
        "click",
        () => tsneSchritteAusfuehren(1)
    );

    document.getElementById(
        "step10-button"
    ).addEventListener(
        "click",
        () => tsneSchritteAusfuehren(10)
    );

    document.getElementById(
        "links-button"
    ).addEventListener(
        "click",
        () => ansichtDrehen(0, -0.12)
    );

    document.getElementById(
        "rechts-button"
    ).addEventListener(
        "click",
        () => ansichtDrehen(0, 0.12)
    );

    document.getElementById(
        "oben-button"
    ).addEventListener(
        "click",
        () => ansichtDrehen(-0.12, 0)
    );

    document.getElementById(
        "unten-button"
    ).addEventListener(
        "click",
        () => ansichtDrehen(0.12, 0)
    );

    document.getElementById(
        "naeher-button"
    ).addEventListener(
        "click",
        () => kameraAbstandAendern(-0.5)
    );

    document.getElementById(
        "weiter-button"
    ).addEventListener(
        "click",
        () => kameraAbstandAendern(0.5)
    );

    document.getElementById(
        "ansicht-reset-button"
    ).addEventListener(
        "click",
        ansichtZuruecksetzen
    );

    window.addEventListener(
        "keydown",
        tastaturBedienen
    );

    window.addEventListener(
        "resize",
        zeichnen
    );
}


// ---------------------------------------------------------
// Tastatur auswerten
// ---------------------------------------------------------

function tastaturBedienen(event) {
    const taste = event.key;

    if (taste === "r" || taste === "R") {
        event.preventDefault();
        tsneNeuStarten();
        return;
    }

    /*
        Ein großes T entsteht durch Shift + T.
        Deshalb wird es vor dem kleinen t geprüft.
    */
    if (taste === "T") {
        event.preventDefault();
        tsneSchritteAusfuehren(10);
        return;
    }

    if (taste === "t") {
        event.preventDefault();
        tsneSchritteAusfuehren(1);
        return;
    }

    if (taste === "ArrowLeft") {
        event.preventDefault();
        ansichtDrehen(0, -0.12);
        return;
    }

    if (taste === "ArrowRight") {
        event.preventDefault();
        ansichtDrehen(0, 0.12);
        return;
    }

    if (taste === "ArrowUp") {
        event.preventDefault();
        ansichtDrehen(-0.12, 0);
        return;
    }

    if (taste === "ArrowDown") {
        event.preventDefault();
        ansichtDrehen(0.12, 0);
        return;
    }

    if (taste === "n" || taste === "N") {
        event.preventDefault();

        /*
            N bewegt die Kamera näher heran.
            Shift + N vergrößert den Abstand.
        */
        if (event.shiftKey) {
            kameraAbstandAendern(0.5);
        } else {
            kameraAbstandAendern(-0.5);
        }
    }
}


// ---------------------------------------------------------
// Anwendung starten
// ---------------------------------------------------------

async function anwendungStarten() {
    try {
        document.getElementById(
            "perplexity-anzeige"
        ).textContent = String(
            EINSTELLUNGEN.perplexity
        );

        document.getElementById(
            "epsilon-anzeige"
        ).textContent = String(
            EINSTELLUNGEN.epsilon
        );

        document.getElementById(
            "iteration-anzeige"
        ).textContent = String(
            EINSTELLUNGEN.gespeicherteIterationen
        );

        webglVorbereiten();
        bedienungVorbereiten();

        await seedsDatenLaden();
        await gespeichertesErgebnisLaden();

        zeichnen();

        console.info(
            "Aufgabe 10 erfolgreich geladen:",
            originalDaten.length,
            "Seeds-Datensätze."
        );
    } catch (fehler) {
        console.error(fehler);

        statusSetzen(
            fehler.message,
            true
        );
    }
}

anwendungStarten();

// =========================================================
// END AUFGABE 10: Seeds-Daten in 3D
// =========================================================