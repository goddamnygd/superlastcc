// The API address and key are not here: calls go to the hub's proxy (DBD.api, see shared/config.js).
const API_BASE_URL = window.DBD.api;

const params = new URLSearchParams(window.location.search);

let selectedMode = params.get("mode") || "mixed";

selectedMode = selectedMode.toLowerCase();

const datalist = document.getElementById("characterNames");
const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");
const guessRows = document.getElementById("guessRows");
const attemptCount = document.getElementById("attemptCount");
const giveUpBtn = document.getElementById("giveUpBtn");
const resultPanel = document.getElementById("resultPanel");
const resultEyebrow = document.getElementById("resultEyebrow");
const resultImage = document.getElementById("resultImage");
const resultName = document.getElementById("resultName");
const resultInfo = document.getElementById("resultInfo");
const playAgainBtn = document.getElementById("playAgainBtn");
const closeResultBtn = document.getElementById("closeResultBtn");
const gameModeTitle = document.getElementById("gameModeTitle");
const modeEyebrow = document.getElementById("modeEyebrow");
const modeDescription = document.getElementById("modeDescription");

let characters = [];
let activeCharacters = [];
let answer = null;
let attempts = 0;
let finished = false;
let guessedIds = new Set();
let round = null;          // set for logged-in players: the SERVER holds the answer and compares every guess
let adminAnswer = "";      // only filled for admin accounts (the answer-key overlay)
let busy = false;

const difficultyOrder = {
    "Easy": 1,
    "Intermediate": 2,
    "Hard": 3,
    "Very Hard": 4
};

async function loadCharacters() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/characters?limit=100&offset=0&sort_by=name&order=asc`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error(
                `API error: ${response.status}`
            );
        }

        const data = await response.json();
        characters = data.characters || [];
        if (characters.length === 0) {
            throw new Error(
                "No characters returned by API."
            );
        }

        configureMode();
        fillCharacterNames();

        // Guests can play each mode once, then they must sign up
        if (!guestAllowed(() => { window.location.href = "index.html#modes"; })) {
            guessInput.placeholder = "SIGN UP TO KEEP PLAYING";
            guessInput.disabled = true;
            return;
        }

        await startRound();
    }

    catch (error) {
        console.error(error);
        guessInput.placeholder = "API COULD NOT BE LOADED";
        guessInput.disabled = true;
    }
}

function guestAllowed(onBack) {
    return !window.DBDAuth || DBDAuth.guestAllow("dbdle:" + selectedMode, onBack);
}

function configureMode() {
    if (selectedMode === "survivor") {
        activeCharacters =
            characters.filter(
                character =>
                    character.role === "Survivor"
            );

        modeEyebrow.textContent = "SURVIVOR ONLY";
        gameModeTitle.textContent = "SURVIVOR MODE";
        modeDescription.textContent = "Only Survivors can be the hidden answer.";
    }

    else if (selectedMode === "killer") {
        activeCharacters =
            characters.filter(
                character =>
                    character.role === "Killer"
            );

        modeEyebrow.textContent = "KILLER ONLY";
        gameModeTitle.textContent = "KILLER MODE";
        modeDescription.textContent = "Only Killers can be the hidden answer.";
    }

    else {
        selectedMode = "mixed";
        activeCharacters = [...characters];
        modeEyebrow.textContent = "SURVIVORS + KILLERS";
        gameModeTitle.textContent = "MIXED MODE";
        modeDescription.textContent = "Survivors and Killers are both included.";
    }
}

function fillCharacterNames() {
    datalist.innerHTML = "";

    activeCharacters.forEach(character => {
        const option = document.createElement("option");
        option.value = character.name;
        datalist.appendChild(option);
    });
}

async function startRound() {
    if (window.DBDAuth) {
        await DBDAuth.ready;
    }

    round = null;
    answer = null;
    adminAnswer = "";

    if (window.DBDAuth && DBDAuth.isLoggedIn()) {
        // Logged in: the server picks the hidden character. We never receive it until the round is over.
        busy = true;

        try {
            round = await DBDAuth.api("/games/round", {
                method: "POST",
                body: { game: "dbdle", mode: selectedMode }
            });
        } catch (error) {
            busy = false;
            flashInvalid((error.message || "COULD NOT START A ROUND").toUpperCase());
            return;
        }

        busy = false;

        if (DBDAuth.isAdmin()) {
            DBDAuth.api("/games/round/" + round.round_id + "/answer")
                .then(result => { adminAnswer = result.name || ""; })
                .catch(() => {});
        }
    } else {
        // Guest: nothing is at stake, so the round stays in the browser
        answer =
            activeCharacters[
                Math.floor(
                    Math.random() *
                    activeCharacters.length
                )
            ];
    }

    attempts = 0;
    finished = false;
    guessedIds = new Set();
    attemptCount.textContent = "0";
    guessRows.innerHTML = "";
    guessInput.value = "";
    guessInput.disabled = false;

    resultPanel.classList.add(
        "hidden"
    );

    setTimeout(
        () => guessInput.focus(),
        100
    );
}

guessForm.addEventListener(
    "submit",

    async event => {
        event.preventDefault();

        if (finished || busy) {
            return;
        }

        const typed =
            normalize(
                guessInput.value
            );

        const guessedCharacter =
            activeCharacters.find(
                character =>
                    normalize(character.name)
                    === typed
            );

        if (!guessedCharacter) {
            flashInvalid();
            return;
        }

        if (
            guessedIds.has(
                guessedCharacter.id
            )
        ) {
            flashInvalid(
                "YOU ALREADY GUESSED THAT CHARACTER"
            );

            return;
        }

        if (round) {
            await guessOnServer(guessedCharacter);
            return;
        }

        // Guest round (local)
        guessedIds.add(
            guessedCharacter.id
        );
        attempts++;
        attemptCount.textContent = attempts;
        addGuessRow(
            guessedCharacter,
            localCompare(guessedCharacter, answer)
        );

        guessInput.value = "";

        if (
            guessedCharacter.id
            === answer.id
        ) {
            finishRound(true);
        }
    }
);

async function guessOnServer(guessedCharacter) {
    busy = true;

    try {
        const result = await DBDAuth.api("/games/round/" + round.round_id + "/guess", {
            method: "POST",
            body: { character_id: guessedCharacter.id }
        });

        guessedIds.add(guessedCharacter.id);
        attempts = result.attempts;
        attemptCount.textContent = attempts;
        addGuessRow(guessedCharacter, result.comparison);
        guessInput.value = "";

        if (result.finished) {
            answer = result.answer;
            finishRound(result.won, result.xp);
        }
    } catch (error) {
        flashInvalid((error.message || "SOMETHING WENT WRONG").toUpperCase());
    } finally {
        busy = false;
    }
}

// Clue states for one guess. Guests use localCompare (below); logged-in players get the same
// shape from the server, so the answer never has to be in the browser.
//   text clues:  correct / partial / wrong
//   year, difficulty: correct / higher (the answer is higher) / lower / wrong
function localCompare(guess, target) {
    return {
        role: compareText(guess.role, target.role),
        gender: compareText(guess.gender, target.gender),
        origin: compareMultiValue(guess.origin, target.origin),
        realm: compareText(guess.realm, target.realm),
        dlc: compareDlc(guess.dlc, target.dlc),
        year: compareOrdered(guess.year, target.year),
        difficulty: compareOrdered(
            difficultyOrder[guess.difficulty] || 0,
            difficultyOrder[target.difficulty] || 0
        )
    };
}

function compareOrdered(guessValue, targetValue) {
    if (guessValue === targetValue) {
        return "correct";
    }

    if (!guessValue || !targetValue) {
        return "wrong";
    }

    return guessValue < targetValue ? "higher" : "lower";
}

function addGuessRow(character, cmp) {
    const row = document.createElement("div");

    row.className = "guess-row";

    row.appendChild(makeCharacterCell(character));
    row.appendChild(makeTextCell(character.role, cmp.role));
    row.appendChild(makeTextCell(character.gender, cmp.gender));
    row.appendChild(makeTextCell(character.origin, cmp.origin));
    row.appendChild(makeTextCell(character.realm, cmp.realm));
    row.appendChild(makeTextCell(character.dlc, cmp.dlc));
    row.appendChild(makeOrderedCell(character.year, cmp.year));
    row.appendChild(makeOrderedCell(character.difficulty, cmp.difficulty));

    guessRows.prepend(
        row
    );
}

function makeCharacterCell(character) {
    const cell = document.createElement("div");
    cell.className = "guess-cell character-cell";
    const image = document.createElement("img");
    image.src = character.image || "";
    image.alt = character.name;
    const label = document.createElement("span");
    label.textContent = character.name;
    cell.appendChild(image);
    cell.appendChild(label);
    return cell;
}

function makeTextCell(
    value,
    state
) {
    const cell = document.createElement("div");
    cell.className = `guess-cell ${state}`;
    cell.textContent = value || "N/A";
    return cell;
}

function makeOrderedCell(value, state) {
    const cell = document.createElement("div");
    cell.className = state === "correct" ? "guess-cell correct" : "guess-cell wrong";
    cell.textContent = value;

    if (state === "higher" || state === "lower") {
        const arrow = document.createElement("span");
        arrow.className = "direction-arrow";
        arrow.textContent = state === "higher" ? "↑" : "↓";
        cell.appendChild(arrow);
    }

    return cell;
}

function compareText(
    guess,
    target
) {
    return normalize(guess)
        === normalize(target)
        ? "correct"
        : "wrong";
}

function compareMultiValue(
    guess,
    target
) {
    if (
        normalize(guess)
        === normalize(target)
    ) {
        return "correct";
    }

    const guessParts = splitMultiValue(guess);
    const targetParts = splitMultiValue(target);
    const overlap =
        guessParts.some(
            part =>
                targetParts.includes(part)
        );

    return overlap
        ? "partial"
        : "wrong";
}

function compareDlc(
    guess,
    target
) {
    if (
        normalize(guess)
        === normalize(target)
    ) {
        return "correct";
    }

    const guessText = normalize(guess);
    const targetText = normalize(target);

    if (
        guessText.includes(
            targetText
        )
        ||
        targetText.includes(
            guessText
        )
    ) {
        return "partial";
    }

    return "wrong";
}

function splitMultiValue(value) {
    return String(value || "")
        .toLowerCase()
        .split(/[,/&]/)
        .map(
            item => item.trim()
        )
        .filter(Boolean);
}

function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(
            /[’']/g,
            "'"
        )
        .replace(
            /\s+/g,
            " "
        );
}

function flashInvalid(
    message =
        "CHOOSE A VALID CHARACTER FOR THIS MODE"
) {
    if (window.DBDFX) DBDFX.shake(guessForm);
    const oldPlaceholder = guessInput.placeholder;
    guessInput.value = "";
    guessInput.placeholder = message;

    setTimeout(
        () => {
            guessInput.placeholder = oldPlaceholder;
        },
        1400
    );
}

giveUpBtn.addEventListener(
    "click",

    async () => {
        if (finished || busy) {
            return;
        }

        if (round) {
            busy = true;

            try {
                const result = await DBDAuth.api("/games/round/" + round.round_id + "/giveup", { method: "POST" });
                answer = result.answer;
            } catch (error) {
                flashInvalid((error.message || "SOMETHING WENT WRONG").toUpperCase());
                return;
            } finally {
                busy = false;
            }
        }

        finishRound(false);
    }
);

function finishRound(won, xp) {
    finished = true;

    if (won && xp && window.DBDAuth) DBDAuth.showWin(xp);   // the server already awarded the XP

    guessInput.disabled = true;

    resultEyebrow.textContent =
        won
            ? "YOU FOUND THEM"
            : "THE FOG CLAIMED THIS ROUND";

    resultImage.src = answer.image || "";
    resultName.textContent = answer.name.toUpperCase();
    resultInfo.textContent =
        `${answer.role} • ` +
        `${answer.origin} • ` +
        `${answer.dlc} • ` +
        `${answer.year}`;

    resultPanel.classList.remove(
        "hidden"
    );

    if (window.DBDFX) {
        if (won) { DBDFX.flash("gold"); DBDFX.burst(innerWidth / 2, innerHeight * .45, { count: 70 }); }
        else { DBDFX.flash("red"); }
    }
}

playAgainBtn.addEventListener(
    "click",

    () => {
        if (busy || !guestAllowed()) {
            return;
        }

        resultPanel.classList.add(
            "hidden"
        );

        startRound();

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }
);

closeResultBtn.addEventListener(
    "click",

    () => {
        resultPanel.classList.add(
            "hidden"
        );
    }
);

document.addEventListener(
    "keydown",

    event => {
        if (
            event.key === "Escape" &&
            !resultPanel.classList.contains("hidden")
        ) {
            resultPanel.classList.add(
                "hidden"
            );
        }
    }
);

loadCharacters();


// Admin answer key (shown only to admin accounts by auth.js)
window.DBDCheat = {
    getAnswer: () => {
        if (finished) return "";
        if (round) return adminAnswer;
        return answer ? answer.name : "";
    }
};
