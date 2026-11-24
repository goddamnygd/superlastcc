// The API address and key are not here: calls go to the hub's proxy (DBD.api, see shared/config.js).
const API_URL = window.DBD.api;

let currentPage = 0;
const limit = 14;
let currentRole = "";
let currentQuery = "";
let debounceTimer = null;

// Escape API text before it goes into innerHTML (the login token lives in this page's storage)
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}


// CENTRALIZED FETCH OPTIONS
const fetchOptions = {
    cache: "no-store"
};


// GET ALL CHARACTERS
async function loadCharacters(page = 0, role = "") {
    try {
        currentPage = parseInt(page, 10);
        currentRole = role;
        currentQuery = "";
        const offset = currentPage * limit;
        let url = `${API_URL}/characters?limit=${limit}&offset=${offset}`;
        if (role) {
            url += `&role=${encodeURIComponent(role)}`;
        }

        console.log("Requesting:", url);
        const response = await fetch(url, fetchOptions);
        console.log("Status:", response.status);
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        const data = await response.json();
        console.log("API Data:", data);
        displayCharacters(data.characters);
        updatePaginationControls(data.total, currentPage);
        markFilter(role);
        showTotal(data.total, role);

    } catch (error) {
        console.error("Error loading characters:", error);
        const container = getContainer();
        if (container) {
            container.innerHTML = `<p>API Error: ${esc(error.message)}</p>`;
        }
    }
}


// SEARCH CHARACTERS
async function searchCharacters(page = 0) {
    const searchInput = document.getElementById("searchInput");
    const query = searchInput ? searchInput.value.trim() : "";

    if (!query) {
        loadCharacters(0, currentRole);
        return;
    }

    try {
        currentPage = parseInt(page, 10);
        currentQuery = query;
        const offset = currentPage * limit;
        const url = `${API_URL}/characters/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
        console.log("Searching:", url);
        const response = await fetch(url, fetchOptions);
        console.log("Search Status:", response.status);

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        const data = await response.json();
        let results = data.results || [];

        // Apply role filter if one is currently selected
        if (currentRole) {
            results = results.filter(character =>
                character.role.toLowerCase() === currentRole.toLowerCase()
            );
        }
        displayCharacters(results);
        updatePaginationControls(data.total, currentPage);

    } catch (error) {
        console.error("Search failed:", error);
        const container = getContainer();
        if (container) {
            container.innerHTML = `<p>Search Error: ${esc(error.message)}</p>`;
        }
    }
}


// DISPLAY CHARACTERS IN GRID
function displayCharacters(characters) {
    const listContainer = getContainer();
    if (!listContainer) return;
    listContainer.innerHTML = "";
    if (!characters || characters.length === 0) {
        listContainer.innerHTML = "<p>No characters found in the fog.</p>";
        return;
    }

    buildReel(characters);
    characters.forEach((character, index) => {
        const card = document.createElement("div");
        card.className = "agent-card";
        card.style.setProperty("--i", index);
        card.onclick = () => viewCharacter(character.id);
        const imageUrl = character.image || "https://via.placeholder.com/300x400/090a0c/a82424?text=DBD+Entity";
        card.innerHTML = `
            <div class="agent-year">${esc(character.character_code)}</div>
            <div class="card-portrait">
                <img src="${esc(imageUrl)}" alt="${esc(character.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x400/090a0c/a82424?text=DBD+Entity'">
            </div>
            <div class="card-content">
                <h3>${esc(character.name)}</h3>
                <p class="agent-origin">${esc(character.role)} • ${esc(character.realm)}</p>
                <button onclick="event.stopPropagation(); viewCharacter(${esc(character.id)})">View Details</button>
            </div>
        `;

        listContainer.appendChild(card);
    });
}


// GET SINGLE CHARACTER FOR MODAL
async function viewCharacter(id) {
    try {
        const url = `${API_URL}/characters/${id}`;
        console.log("Character Request:", url);
        const response = await fetch(url, fetchOptions);
        console.log("Character Status:", response.status);
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        const character = await response.json();
        console.log("Character Data:", character);
        const modalBody = document.getElementById("modalBody");
        if (!modalBody) return;
        const imageUrl = character.image || "https://via.placeholder.com/300x400/090a0c/a82424?text=DBD+Entity";
        const powerSection = character.power && character.power !== "None"
            ? `<p><strong>Power:</strong> ${esc(character.power)}</p>`
            : `<p><strong>Power:</strong> N/A (Survivor)</p>`;

        modalBody.innerHTML = `
            <div class="modal-body-layout">
                <img src="${esc(imageUrl)}" alt="${esc(character.name)}" class="modal-portrait" onerror="this.src='https://via.placeholder.com/300x400/090a0c/a82424?text=DBD+Entity'">
                <div class="modal-header">
                    <h2>${esc(character.name)} <span style="font-size: 0.85rem; color: #808792;">[${esc(character.character_code)}]</span></h2>
                    <p class="agent-origin">${esc(character.role)} • ${esc(character.gender)} • ${esc(character.origin)}</p>
                    <p style="font-size: 0.85rem; color: #808792; margin-top: 0.4rem;">
                        <strong>Difficulty:</strong> ${esc(character.difficulty)} | <strong>Released:</strong> ${esc(character.year)}
                    </p>
                </div>
            </div>   
            <p style="line-height: 1.6;">${esc(character.description)}</p>
            <div class="skills-list">
                <p><strong>Realm:</strong> ${esc(character.realm)}</p>
                <p><strong>DLC Chapter:</strong> ${esc(character.dlc)}</p>
                ${powerSection}
                <p><strong>Base Speed:</strong> ${esc(character.movement_speed || "N/A")}</p>
                <p><strong>Terror Radius:</strong> ${esc(character.terror_radius || "N/A")}</p>
                <p><strong>Height:</strong> ${esc(character.height || "N/A")}</p>
                <p><strong>Voice Actor:</strong> ${esc(character.voice_actor || "N/A")}</p>
                <p><strong>Perk 1:</strong> ${esc(character.perk_1 || "N/A")}</p>
                <p><strong>Perk 2:</strong> ${esc(character.perk_2 || "N/A")}</p>
                <p><strong>Perk 3:</strong> ${esc(character.perk_3 || "N/A")}</p>
            </div>
        `;

        // One avatar per account: equipping a new one replaces the old one
        if (window.DBDAuth) {
            modalBody.appendChild(DBDAuth.progressBox(character.id));
            modalBody.appendChild(DBDAuth.equipButton(character.id, character.name));
        }

        const modal = getModal();

        if (modal) {
            modal.style.display = "flex";
        }
    } catch (error) {
        console.error("Error fetching character details:", error);

        alert(`Unable to retrieve character details.\n${error.message}`);
    }
}


// MODAL CONTROLS
function closeModal() {
    const modal = getModal();

    if (modal) {
        modal.style.display = "none";
    }
}

window.onclick = function(event) {
    const modal = getModal();

    if (modal && event.target === modal) {
        modal.style.display = "none";
    }
};

// PAGINATION
function updatePaginationControls(totalItems, page) {
    const paginationContainer = document.getElementById("paginationContainer");

    if (!paginationContainer) return;
    const totalPages = Math.ceil(totalItems / limit);
    const prevDisabled = page <= 0 ? "disabled" : "";
    const nextDisabled = (page + 1) >= totalPages ? "disabled" : "";

    paginationContainer.innerHTML = `
        <button ${prevDisabled} onclick="changePage(${page - 1})">Previous</button>
        <span>Page ${page + 1} of ${totalPages || 1}</span>
        <button ${nextDisabled} onclick="changePage(${page + 1})">Next</button>
    `;
}

function changePage(newPage) {
    if (newPage < 0) return;

    if (currentQuery) {
        searchCharacters(newPage);
    } else {
        loadCharacters(newPage, currentRole);
    }
}
// FILTER BUTTON STATE + LIVE TOTAL
function markFilter(role) {
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.classList.toggle("active", (btn.dataset.role || "") === (role || ""));
    });
}
function showTotal(total, role) {
    const stat = document.getElementById("statTotal");
    if (stat && !role && !currentQuery && window.DBDFX && !stat.dataset.done) {
        stat.dataset.done = "1";
        DBDFX.count(stat, Number(total) || 0);
    }
}

// HERO REEL: a slow band of portraits, dim, lit up by the flashlight (the portraits come from the first page of the API)
let reelBuilt = false;
function buildReel(characters) {
    if (reelBuilt) return;
    const pics = (characters || []).filter(c => c.image).slice(0, 12);
    if (pics.length < 4) return;
    reelBuilt = true;
    const tiles = pics.map(c => `<figure><img src="${esc(c.image)}" alt="" loading="lazy"><figcaption>${esc(c.name)}</figcaption></figure>`).join("");
    ["reelDim", "reelLit"].forEach(id => {
        const reel = document.getElementById(id);
        if (reel) reel.innerHTML = `<div class="reel-track">${tiles}${tiles}</div>`;
    });
}

// HELPERS
function getContainer() {
    return document.getElementById("characterList") || document.getElementById("agentList");
}
function getModal() {
    return document.getElementById("agentModal") || document.getElementById("characterModal");
}
// EVENT LISTENERS & DEBOUNCE
document.addEventListener("DOMContentLoaded", () => {
    loadCharacters(0);

    // Live search input with debounce
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            clearTimeout(debounceTimer);

            debounceTimer = setTimeout(() => {
                searchCharacters(0);
            }, 300);
        });
    }
    // Role filter dropdown
    const roleSelect = document.getElementById("roleSelect") || document.getElementById("roleFilter");
    if (roleSelect) {
        roleSelect.addEventListener("change", event => {
            const selectedRole = event.target.value;
            loadCharacters(0, selectedRole);
        });
    }
});
