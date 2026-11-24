// API CONFIGURATION
// The API address and key are not here: calls go to the hub's proxy (DBD.api, see shared/config.js).
const API_BASE_URL = window.DBD.api;

// DOM REFERENCES
const datalist = document.getElementById("characterNames");
const heroCharacter = document.getElementById("heroCharacter");

const gameScreen = document.getElementById("game");
const revealScreen = document.getElementById("reveal");
const descriptionClue = document.getElementById("descriptionClue");
const perksClue = document.getElementById("perksClue");
const imageClue = document.getElementById("imageClue");
const zoomImage = document.getElementById("zoomImage");
const modeLabel = document.getElementById("modeLabel");
const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");
const gameMessage = document.getElementById("gameMessage");
const livesContainer = document.getElementById("lives");
const bloodLayer = document.getElementById("bloodLayer");

const sideLeft = document.getElementById("sideLeft");
const sideRight = document.getElementById("sideRight");

const revealImage = document.getElementById("revealImage");
const revealName = document.getElementById("revealName");
const revealStats = document.getElementById("revealStats");
const resultLabel = document.getElementById("resultLabel");
const playAgainBtn = document.getElementById("playAgainBtn");
const changeModeBtn = document.getElementById("changeModeBtn");

const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");
const homeLink = document.getElementById("homeLink");
const aboutLink = document.getElementById("aboutLink");

// GAME STATE
let characters = [];
let currentCharacter = null;
let currentMode = "description";
let lives = 3;
let answered = false;
let lastCharacterId = null;
let round = null;          // set for logged-in players: the SERVER holds the answer and checks every guess
let adminAnswer = "";      // only filled for admin accounts (the answer-key overlay)
let busy = false;

// API
async function loadCharacters() {
    try {
        const response = await fetch(
           `${API_BASE_URL}/characters?limit=100&offset=0&sort_by=name&order=asc`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        characters = data.characters || [];

        if (characters.length === 0) {
            throw new Error("The API returned no characters.");
        }

        fillCharacterNames();
        setHeroCharacter();
    } catch (error) {
        console.error(error);
        console.error("Could not load characters from the API.");
    }
}

// CHARACTER NAMES + HERO
function fillCharacterNames() {
    datalist.innerHTML = "";

    characters.forEach(character => {
        const option = document.createElement("option");
        option.value = character.name;
        datalist.appendChild(option);
    });
}

function setHeroCharacter() {
    const preferred = characters.find(character => character.role === "Killer" && character.image);
    const fallback = characters.find(character => character.image);

    if (preferred || fallback) {
        heroCharacter.style.setProperty("--img", `url("${(preferred || fallback).image}")`);
    }
}

// START GAME
document.querySelectorAll(".mode-card").forEach(card => {
    card.addEventListener("click", () => {
        currentMode = card.dataset.mode;
        startGame();
    });
});

async function startGame() {
    if (busy) {
        return;
    }

    if (characters.length === 0) {
        alert("Characters are still loading from the API.");
        return;
    }

    // Guests can play each mode once, then they must sign up
    if (window.DBDAuth && !DBDAuth.guestAllow("minigame:" + currentMode)) {
        return;
    }

    // Wait until we know whether the visitor is logged in
    if (window.DBDAuth) {
        await DBDAuth.ready;
    }

    lives = 3;
    answered = false;
    round = null;
    adminAnswer = "";
    gameMessage.textContent = "";
    gameMessage.className = "game-message";
    bloodLayer.innerHTML = "";
    updateLives();

    let clue;

    if (window.DBDAuth && DBDAuth.isLoggedIn()) {
        // Logged in: the server picks the character and only sends the clue
        busy = true;
        try {
            round = await DBDAuth.api("/games/round", {
                method: "POST",
                body: { game: "minigame", mode: currentMode }
            });
        } catch (error) {
            busy = false;
            alert(error.message || "Could not start a round.");
            return;
        }
        busy = false;
        currentCharacter = null;
        clue = round.clue;

        if (DBDAuth.isAdmin()) {
            DBDAuth.api("/games/round/" + round.round_id + "/answer")
                .then(result => { adminAnswer = result.name || ""; })
                .catch(() => {});
        }
    } else {
        // Guest: nothing is at stake, so the round stays in the browser
        currentCharacter = chooseRandomCharacter();
        lastCharacterId = currentCharacter.id;
        clue = localClue(currentCharacter);
    }

    prepareBackgroundCharacters();
    buildClue(clue);

    guessInput.value = "";
    gameScreen.classList.remove("hidden");
    revealScreen.classList.add("hidden");
    document.body.classList.add("game-active");

    setTimeout(() => guessInput.focus(), 120);
}

function chooseRandomCharacter() {
    let pool = characters.filter(character => character.id !== lastCharacterId);

    // Image mode must have an image.
    if (currentMode === "image") {
        pool = pool.filter(character => character.image);
    }

    if (pool.length === 0) {
        pool = characters;
    }

    return pool[Math.floor(Math.random() * pool.length)];
}

function localClue(character) {
    if (currentMode === "description") return { description: character.description };
    if (currentMode === "perks") return { perks: [character.perk_1, character.perk_2, character.perk_3] };
    return { image: character.image };
}

function prepareBackgroundCharacters() {
    const others = characters.filter(
        character => (!currentCharacter || character.id !== currentCharacter.id) && character.image
    );

    const left = others[Math.floor(Math.random() * others.length)];
    const rightPool = others.filter(character => character.id !== left?.id);
    const right = rightPool[Math.floor(Math.random() * rightPool.length)];

    sideLeft.style.backgroundImage = left ? `url("${left.image}")` : "none";
    sideRight.style.backgroundImage = right ? `url("${right.image}")` : "none";
}

// CLUE MODES
function buildClue(clue) {
    descriptionClue.classList.add("hidden");
    perksClue.classList.add("hidden");
    imageClue.classList.add("hidden");

    if (currentMode === "description") {
        modeLabel.textContent = "DESCRIPTION";
        descriptionClue.textContent = clue.description;
        descriptionClue.classList.remove("hidden");
    }

    if (currentMode === "perks") {
        modeLabel.textContent = "PERKS";
        document.getElementById("perk1").textContent = clue.perks[0];
        document.getElementById("perk2").textContent = clue.perks[1];
        document.getElementById("perk3").textContent = clue.perks[2];
        perksClue.classList.remove("hidden");
    }

    if (currentMode === "image") {
        modeLabel.textContent = "ZOOMED IMAGE";
        zoomImage.src = clue.image;
        zoomImage.style.transform = "scale(5.2)";
        imageClue.classList.remove("hidden");
    }
}

// GUESSING
guessForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (answered || busy) {
        return;
    }

    const guess = normalize(guessInput.value);

    if (!guess) {
        return;
    }

    if (round) {
        await guessOnServer(guess);
        return;
    }

    // Guest round (local)
    if (guess === normalize(currentCharacter.name)) {
        answered = true;
        gameMessage.textContent = "CORRECT. THE ENTITY RELEASES YOU.";
        revealCharacter(true);
        return;
    }

    lives--;
    showWrongGuess();

    if (lives <= 0) {
        answered = true;
        setTimeout(() => revealCharacter(false), 700);
    }
});

async function guessOnServer(guess) {
    const picked = characters.find(character => normalize(character.name) === guess);

    if (!picked) {
        gameMessage.textContent = "CHOOSE A CHARACTER FROM THE LIST.";
        gameMessage.className = "game-message wrong";
        return;
    }

    busy = true;

    try {
        const result = await DBDAuth.api("/games/round/" + round.round_id + "/guess", {
            method: "POST",
            body: { character_id: picked.id }
        });

        if (result.correct) {
            answered = true;
            currentCharacter = result.answer;
            gameMessage.textContent = "CORRECT. THE ENTITY RELEASES YOU.";
            revealCharacter(true);
            DBDAuth.showWin(result.xp);
            return;
        }

        lives = result.lives_left;
        showWrongGuess();

        if (result.finished) {
            answered = true;
            currentCharacter = result.answer;
            setTimeout(() => revealCharacter(false), 700);
        }
    } catch (error) {
        gameMessage.textContent = (error.message || "Something went wrong.").toUpperCase();
        gameMessage.className = "game-message wrong";
    } finally {
        busy = false;
    }
}

function showWrongGuess() {
    updateLives();
    createBloodSplatter();

    if (window.DBDFX) {
        DBDFX.shake(document.querySelector(".clue-panel"));
        DBDFX.flash("red");
    }

    gameMessage.textContent =
        lives > 0
            ? `WRONG. ${lives} ${lives === 1 ? "LIFE" : "LIVES"} REMAIN.`
            : "NO LIVES REMAIN.";
    gameMessage.className = "game-message wrong";

    guessInput.value = "";

    if (currentMode === "image" && lives > 0) {
        zoomOutImage();
    }
}

function normalize(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/\s+/g, " ");
}

function updateLives() {
    const lifeIcons = [...livesContainer.children];

    lifeIcons.forEach((icon, index) => {
        icon.classList.toggle("lost", index >= lives);
    });

    livesContainer.setAttribute("aria-label", `${lives} lives remaining`);
}

function zoomOutImage() {
    // Start very close, then reveal more after each wrong guess.
    if (lives === 2) {
        zoomImage.style.transform = "scale(4)";
    } else if (lives === 1) {
        zoomImage.style.transform = "scale(2.8)";
    }
}

// BLOOD EFFECT
function createBloodSplatter() {
    for (let i = 0; i < 18; i++) {
        const drop = document.createElement("span");
        drop.className = "blood-drop";

        drop.style.setProperty("--x", `${Math.random() * 86 + 4}%`);
        drop.style.setProperty("--y", `${Math.random() * 72 + 12}%`);
        drop.style.setProperty("--size", `${Math.random() * 44 + 12}px`);
        drop.style.setProperty("--rot", `${Math.random() * 180}deg`);

        bloodLayer.appendChild(drop);
    }
}

// REVEAL / NEXT ROUND
function revealCharacter(correct) {
    resultLabel.textContent = correct ? "YOU GUESSED" : "THE ANSWER WAS";
    revealName.textContent = currentCharacter.name.toUpperCase();
    revealImage.src = currentCharacter.image || "";
    revealStats.textContent =
        `${currentCharacter.role} • ${currentCharacter.dlc} • ${currentCharacter.year}`;

    gameScreen.classList.add("hidden");
    revealScreen.classList.remove("hidden");
    revealScreen.classList.toggle("lost", !correct);

    if (window.DBDFX) {
        if (correct) { DBDFX.flash("gold"); DBDFX.burst(innerWidth / 2, innerHeight * .55); }
        else { DBDFX.flash("red"); }
    }
}

playAgainBtn.addEventListener("click", () => {
    startGame();
});

changeModeBtn.addEventListener("click", () => {
    closeGameScreens();
});

// RETURN TO MAIN PAGE
function closeGameScreens() {
    gameScreen.classList.add("hidden");
    revealScreen.classList.add("hidden");
    document.body.classList.remove("game-active");
    bloodLayer.innerHTML = "";
    answered = false;
    gameMessage.textContent = "";
    guessInput.value = "";
}

homeLink.addEventListener("click", () => {
    closeGameScreens();
    navMenu.classList.remove("open");
});

aboutLink.addEventListener("click", () => {
    closeGameScreens();
    navMenu.classList.remove("open");
});

// MOBILE NAVIGATION
menuBtn.addEventListener("click", () => {
    navMenu.classList.toggle("open");
});

navMenu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
        navMenu.classList.remove("open");
    });
});

// SMALL SAFETY HELPER
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// Load the API as soon as the page opens.
loadCharacters();


// Admin answer key (shown only to admin accounts by auth.js)
window.DBDCheat = {
    getAnswer: () => {
        if (answered) return "";
        if (round) return adminAnswer;
        return currentCharacter ? currentCharacter.name : "";
    }
};
