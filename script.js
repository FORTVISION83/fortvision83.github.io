document.getElementById('closeMenuBtn').addEventListener('click', function () {
        var menu = document.getElementById('navbarFullscreen');
        var bsCollapse = bootstrap.Collapse.getOrCreateInstance(menu);
        bsCollapse.hide();
});

const urlParams = new URLSearchParams(window.location.search);
const selectedParcours = urlParams.get('parcours') || 'parcours1' || 'parcours2';

let currentOpenPoint = null;
let popupDelayActive = true;
let activeCircle = null;
let map = null;
let userMarker = null;
let watchId = null;
let wanderMode = false; // Flag pour savoir si on est en mode errante ou auto
let parcours; // parcours global

function createNumberedIcon(number, state) {
        let className = 'custom-number-icon ';
        switch (state) {
                case 'visited':
                        className += 'visited'; // Orange
                        break;
                case 'next-point':
                        className += 'next-point'; // Vert menthe
                        break;
                default:
                        className += 'non-visited'; // Vert foncé
        }

        return L.divIcon({
                className: className,
                html: `<div class="circle">${number}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
        });
}


function getNextPoint(parcours) {
        for (let i = 0; i < parcours.points.length; i++) {
                if (!parcours.points[i].visite) {
                        return i;
                }
        }
        return -1; // Tous les points sont visités
}
function updateAllMarkers() {
        const nextIdx = getNextPointIndex(parcours.points);
        parcours.points.forEach((pt, i) => {
                const state = pt.visite
                        ? 'visited'
                        : (i === nextIdx ? 'next-point' : 'non-visited');
                pt.marker.setIcon(createNumberedIcon(i + 1, state));
        });
}
function getNextPointIndex(points) {
        return points.findIndex(p => p.visite === false);
}


function debounce(func, wait) {
        let timeout;
        return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
        };
}

function updateSidebarLabel(title) {
        const sidebarLabel = document.getElementById('sidebarLabel');
        sidebarLabel.textContent = title || "Point Information";
}

function showSidebar(content) {
        const sidebarContent = document.getElementById('sidebar-content');
        sidebarContent.innerHTML = content;
        const sidebar = new bootstrap.Offcanvas(document.getElementById('sidebar'));
        sidebar.show();
}

function updatePlacesList(points, userCoords) {
        const placesList = document.getElementById('places-list');
        placesList.innerHTML = "";

        if (!points || points.length === 0) {
                placesList.innerHTML = "<li>Aucun point à proximité</li>";
                return;
        }

        points.forEach(point => {
                const distance = userCoords
                        ? Math.round(turf.distance(
                                turf.point([userCoords[1], userCoords[0]]),
                                turf.point([point.coords[1], point.coords[0]])
                        ) * 1000)
                        : "N/A";

                const listItem = document.createElement('li');
                listItem.innerHTML = `<strong>${point.titre}</strong> - ${distance}m`;
                placesList.appendChild(listItem);

                listItem.addEventListener('click', () => {
                        if (map) {
                                map.setView(point.coords, 18);
                        }
                });
        });
}

function refreshCoordsDisplay() {
        const listEl = document.getElementById('coords-list');
        listEl.innerHTML = '';
        parcours.points.forEach(point => {
                const lat = point.coords[0].toFixed(6);
                const lng = point.coords[1].toFixed(6);
                const li = document.createElement('li');
                li.textContent = `${point.titre} : ${lat}, ${lng}`;
                listEl.appendChild(li);
        });
}


function initializeMap(parcours, initialCoords) {
        map = L.map('map', {
                maxBounds: [
                        [43.08424, 5.883318], // Sud-Ouest
                        [43.10424, 5.903318]  // Nord-Est
                ],
                zoom: 17,
                minZoom: 16,
                maxZoom: 18,
                maxBoundsViscosity: 1.0, // Empêche le déplacement en dehors des bounds
                zoomControl: false

        }).setView(initialCoords, 18);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

        userMarker = L.marker([0, 0], {
                icon: L.icon({
                        iconUrl: 'images/user.svg',
                        iconSize: [25, 25],
                        iconAnchor: [16, 32],
                        className: 'marker-icon'
                }),
                zIndexOffset: 10000 //= Visible Par dessus les poi
        }).addTo(map);


        // Ajouter les marqueurs pour chaque point du parcours
        parcours.points.forEach((point, index) => {
                const marker = L.marker(point.coords, {
                        icon: createNumberedIcon(index + 1, 'normal')
                }).bindTooltip(point.titre, { permanent: false, direction: 'top' }).addTo(map);

                point.marker = marker;
                point.visite = false;
                point.index = index;

                marker.on('click', () => {
                        const content = `
                                <div onclick="openFullscreenVideo('${point.video}')" style="cursor:pointer;">
                                <video muted style="width:100%; max-height:200px; object-fit:cover;" preload="metadata">
                                <source src="${point.video}" type="video/mp4">
                                Votre navigateur ne supporte pas la lecture vidéo.
                                </video>
                                </div>
                                <p class="pt-4">${point.description}</p>
                                `;

                        showSidebar(content);
                        updateSidebarLabel(point.titre);
                        currentOpenPoint = point.titre;
                        map.setView(point.coords, 18);
                });

                point.zone = turf.buffer(
                        turf.point([point.coords[1], point.coords[0]]),
                        point.radius / 1000,
                        { units: 'kilometers' }
                );


        });
        updateAllMarkers(); // Initialise les états des marqueurs

        // Tracer le parcours avec une ligne
        const polylinePoints = parcours.points.map(point => point.coords);
        L.polyline(polylinePoints, { color: 'lightgreen', weight: 3 }).addTo(map);

        // Activer les popups avec délai
        setTimeout(() => {
                popupDelayActive = false;
        }, 1500);

        // Géolocalisation
        if (navigator.geolocation) {
                watchId = navigator.geolocation.watchPosition(
                        debounce(position => {
                                // Si on est en Mode Errante, on ignore la maj auto
                                if (wanderMode) return;

                                const userCoords = [position.coords.latitude, position.coords.longitude];
                                const userPoint = turf.point([userCoords[1], userCoords[0]]);

                                userMarker.setLatLng(userCoords);

                                if (!map.getBounds().contains(userCoords)) {
                                        document.getElementById('status').textContent = "⚠️ Vous êtes hors de la zone ou votre géolocation est imprécise. Veuillez passer en mode 'MODE LIBRE' pour visiter virtuellement.";

                                        const latlngs = parcours.points.map(p => p.coords);
                                        const bounds = L.latLngBounds(latlngs);
                                        map.fitBounds(bounds, { padding: [50, 50] });

                                        return;
                                }

                                let isInAnyZone = false;
                                let closestDistance = Infinity;
                                let nearestPoint = null;

                                parcours.points.forEach(point => {
                                        const distance = turf.distance(
                                                userPoint,
                                                turf.point([point.coords[1], point.coords[0]])
                                        ) * 1000;

                                        // Marquer visité seulement si on entre dans la zone
                                        if (!point.visite && turf.booleanPointInPolygon(userPoint, point.zone)) {
                                                point.visite = true;
                                                // updateAllMarkers(); // Met à jour tous les marqueurs
                                        }


                                        if (distance < closestDistance) {
                                                closestDistance = distance;
                                                nearestPoint = point;
                                        }

                                        if (!popupDelayActive && turf.booleanPointInPolygon(userPoint, point.zone)) {
                                                isInAnyZone = true;

                                                if (currentOpenPoint !== point.titre) {
                                                        const content = `
                                        <div onclick="openFullscreenVideo('${point.video}')" style="cursor:pointer;">
                                        <video muted style="width:100%; max-height:200px; object-fit:cover;" preload="metadata">
                                        <source src="${point.video}" type="video/mp4">
                                        Votre navigateur ne supporte pas la lecture vidéo.
                                        </video>
                                        </div>
                                        <p>${point.description}</p>
                                        // <p><strong>Distance:</strong> ${Math.round(distance)}m</p>
                                        `;

                                                        showSidebar(content);
                                                        updateSidebarLabel(point.titre);
                                                        currentOpenPoint = point.titre;

                                                        if (activeCircle) map.removeLayer(activeCircle);
                                                        activeCircle = L.circle(point.coords, {
                                                                radius: point.radius,
                                                                color: '#007bff',
                                                                fillOpacity: 0.1
                                                        }).addTo(map);

                                                        map.setView(point.coords, 18);
                                                }
                                        } else if (currentOpenPoint === point.titre) {
                                                currentOpenPoint = null;
                                                updateSidebarLabel(null);

                                                if (activeCircle) {
                                                        map.removeLayer(activeCircle);
                                                        activeCircle = null;
                                                }
                                        }
                                });

                                // Recentrer sur l'utilisateur seulement s'il est dans les limites
                                if (!isInAnyZone) {
                                        map.setView(userCoords, 18);
                                }

                                document.getElementById('status').textContent = nearestPoint ?
                                        `📍 ${nearestPoint.titre} - Distance : ${Math.round(closestDistance)}m` :
                                        "Aucun point proche";

                                updatePlacesList(parcours.points, userCoords);
                        }, 200),
                        error => {
                                document.getElementById('status').textContent = '❌ Autorisez la géolocalisation pour utiliser cette fonctionnalité.';
                                alert("La géolocalisation est nécessaire pour profiter pleinement de l'expérience. Veuillez autoriser l'accès.");
                                updatePlacesList(parcours.points, null);
                        },
                        {
                                enableHighAccuracy: true,
                                timeout: 2000,
                        }
                );
        } else {
                document.getElementById('status').textContent = '❌ Géolocalisation non supportée par votre navigateur';
                alert("Votre navigateur ne supporte pas la géolocalisation.");
                updatePlacesList(parcours.points, null);
        }
        map.on('click', function (e) {
                if (!wanderMode) return;
                const { lat, lng } = e.latlng;
                userMarker.setLatLng([lat, lng]);
                map.panTo([lat, lng]);
                processUserCoords([lat, lng]);
        });
}

// Errante mode pour gérer position manuelle
function processUserCoords(coords) {
        const userPoint = turf.point([coords[1], coords[0]]);
        userMarker.setLatLng(coords);

        let closestPoint = null;
        let closestDistance = Infinity;

        parcours.points.forEach((point, index) => {
                const distance = turf.distance(
                        userPoint,
                        turf.point([point.coords[1], point.coords[0]])
                ) * 1000;

                // Marquer “visité” si on entre dans la zone pour la première fois
                if (!point.visite && turf.booleanPointInPolygon(userPoint, point.zone)) {
                        point.visite = true;
                        updateAllMarkers();
                }

                if (distance < closestDistance) {
                        closestDistance = distance;
                        closestPoint = point;
                }

                if (!popupDelayActive && turf.booleanPointInPolygon(userPoint, point.zone)) {
                        if (currentOpenPoint !== point.titre) {
                                const content = `
                                <div onclick="openFullscreenVideo('${point.video}')" style="cursor:pointer;">
                                <video muted style="width:100%; max-height:200px; object-fit:cover;" preload="metadata">
                                <source src="${point.video}" type="video/mp4">
                                Votre navigateur ne supporte pas la lecture vidéo.
                                </video>
                                </div>
                                <p>${point.description}</p>
                                <p><strong>Distance:</strong> ${Math.round(distance)}m</p>
                                `;
                                showSidebar(content);
                                updateSidebarLabel(point.titre);
                                currentOpenPoint = point.titre;

                                if (activeCircle) map.removeLayer(activeCircle);
                                activeCircle = L.circle(point.coords, {
                                        radius: point.radius,
                                        color: '#007bff',
                                        fillOpacity: 0.1
                                }).addTo(map);

                                map.setView(point.coords, 18);
                        }
                } else if (currentOpenPoint === point.titre) {
                        currentOpenPoint = null;
                        updateSidebarLabel(null);
                        if (activeCircle) {
                                map.removeLayer(activeCircle);
                                activeCircle = null;
                        }
                }
        });

        document.getElementById('status').textContent = closestPoint
                ? `📍 ${closestPoint.titre} - Distance : ${Math.round(closestDistance)}m`
                : "Aucun point proche";

        updatePlacesList(parcours.points, coords);

}

document.getElementById("toggleWander").addEventListener("click", () => {
        wanderMode = !wanderMode;

        const btn = document.getElementById("toggleWander");
        const fields = document.getElementById("wander-fields");
        // const display = document.getElementById("wander-coords-display");

        btn.innerText = wanderMode ? "DESACTIVER" : "MODE LIBRE";
        fields.style.display = wanderMode ? "block" : "none";
        document.getElementById("status").textContent = wanderMode
                ? "🧭 Mode visite libre activé - Vous pouvez vous déplacer librement en cliquant sur la carte"
                : "⌛ Géolocalisation automatique réactivée";

        if (wanderMode) {
                // Visuel facultatif pour signaler l’activation (changement de curseur, CSS…)
                map.getContainer().style.cursor = 'crosshair';
        } else {
                map.getContainer().style.cursor = '';
                window.location.reload();
        }

});


fetch('data.json')
        .then(response => response.json())
        .then(data => {

                // Sélection dynamique du parcours
                const parcoursNoms = Object.keys(data);
                const urlParams = new URLSearchParams(window.location.search);
                const paramParcours = urlParams.get('parcours');
                let selectedParcours = parcoursNoms[0];
                if (paramParcours && parcoursNoms.includes(paramParcours)) {
                        selectedParcours = paramParcours;
                }

                parcours = data[selectedParcours];
                if (!parcours) {
                        alert("Parcours non trouvé !");
                        window.location.href = "index.html";
                        return;
                }

                window.parcours = parcours;
                const parcoursNom = parcours.nom || selectedParcours;
                const parcoursActuelElem = document.getElementById("parcours-actuel");
                if (parcoursActuelElem) {
                        parcoursActuelElem.innerHTML = `<h2 class="nav-link fs-2 text-white" style="text-decoration: underline; font-weight:600;">Parcours en cours :</h2>${parcoursNom}`;
                }

                if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                                position => {
                                        const userCoords = [position.coords.latitude, position.coords.longitude];
                                        initializeMap(parcours, userCoords);
                                },
                                error => {
                                        initializeMap(parcours, parcours.points[0].coords);
                                }
                        );
                } else {
                        initializeMap(parcours, parcours.points[0].coords);
                }
                parcours.points.forEach(pt => {
                        pt.visite = false;
                });
        });



function openFullscreenVideo(src) {
        const video = document.getElementById('fullscreenVideo');
        video.src = src;
        video.play();

        const modal = new bootstrap.Modal(document.getElementById('videoModal'));
        modal.show();

        document.getElementById('videoModal').addEventListener('hidden.bs.modal', () => {
                video.pause();
                video.src = "";
        }, { once: true });
}