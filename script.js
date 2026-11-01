import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const loader = document.querySelector(".loader");
const loaderFill = document.querySelector(".loader-fill");
const loaderPercent = document.querySelector(".loader-percent");
const menu = document.querySelector(".menu");
const nav = document.querySelector("#nav");
const form = document.querySelector("#contact-form");
const statusEl = document.querySelector("#form-status");
const header = document.querySelector(".header");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LOADER_FALLBACK_DELAY = 10000;
const INTRO = { converge: 2600, hold: 500, type: 1100, finish: 400 };
const INTRO_TYPE_START = INTRO.converge + INTRO.hold;
const INTRO_TYPE_END = INTRO_TYPE_START + INTRO.type;
const INTRO_TOTAL_END = INTRO_TYPE_END + INTRO.finish;
const skullCanvas = document.getElementById("loader-skull-canvas");
let skullScene = null;
let skullCamera = null;
let skullRenderer = null;
let skullModel = null;
let skullGenerationFailed = false;
const ghostCoder = document.querySelector(".ghost-coder");
const ghostText = document.querySelector(".ghost-text");
const GHOST_TEXT = "ghost_coder";
const GHOST_TYPE_SPEED = 110;

let loaderFinished = false;
let pageLoaded = document.readyState === "complete";
let forcedFinish = false;
let introStart = 0;
let rafId = 0;
let revealStarted = false;
let loaderSafetyTimer = null;
let lastPercent = -1;
let ghostStarted = false;
let ghostFinished = false;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function setLoaderProgress(value) {
    const progress = Math.min(100, Math.max(0, value));
    if (loaderFill) {
        loaderFill.style.width = `${progress.toFixed(2)}%`;
    }
    const rounded = Math.round(progress);
    if (loaderPercent && rounded !== lastPercent) {
        loaderPercent.textContent = `${rounded}%`;
        lastPercent = rounded;
    }
}

function setupSkullRenderer() {
    if (!skullCanvas) throw new Error("Canvas du crâne 3D absent");

    skullRenderer = new THREE.WebGLRenderer({
        canvas: skullCanvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
    });
    skullRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    skullRenderer.setClearColor(0x000000, 0);
    skullRenderer.outputColorSpace = THREE.SRGBColorSpace;

    skullScene = new THREE.Scene();
    skullCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    skullCamera.position.set(0, 0, 5.8);
    const keyLight = new THREE.DirectionalLight(0xfff3d4, 2.2);
    const rimLight = new THREE.DirectionalLight(0xb27b32, 1.1);
    keyLight.position.set(2.5, 3, 4);
    rimLight.position.set(-3, -2, 2);
    skullScene.add(new THREE.AmbientLight(0xffe6b5, 1.5), keyLight, rimLight);

    const resize = () => {
        const size = Math.min(skullCanvas.clientWidth || 320, 360);
        skullRenderer.setSize(size, size, false);
        skullCamera.aspect = 1;
        skullCamera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
}

function buildSkullFragments() {
    if (!skullRenderer) setupSkullRenderer();

    const skullUrl = new URL("./assets/skull-3d/scattering-skull.glb", window.location.href).href;
    new GLTFLoader().load(
        skullUrl,
        (gltf) => {
            const model = gltf.scene;
            model.traverse((part) => {
                if (!part.isMesh) return;
                part.castShadow = false;
                part.receiveShadow = false;
                part.material = new THREE.MeshStandardMaterial({
                    color: 0xd8c49a,
                    roughness: 0.68,
                    metalness: 0.05,
                });
            });

            const bounds = new THREE.Box3().setFromObject(model);
            const center = bounds.getCenter(new THREE.Vector3());
            const dimensions = bounds.getSize(new THREE.Vector3());
            const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
            model.position.sub(center);
            model.scale.setScalar(1.9 / maxDimension);
            model.rotation.set(0.08, -0.58, 0);
            skullScene.add(model);
            skullModel = model;
            skullGenerationFailed = false;
            loader?.classList.add("skull-active");
            console.info("[LOADER] Modèle 3D CC0 chargé:", skullUrl);
        },
        undefined,
        (error) => {
            skullGenerationFailed = true;
            console.error("[LOADER] Chargement du modèle 3D impossible:", error);
            showStaticSkull();
        }
    );
}

function renderSkullFrame(elapsed) {
    if (!skullRenderer || !skullScene || !skullCamera) return;

    if (skullModel && !reduceMotion && !loaderFinished) {
        const bounce = Math.abs(Math.sin(elapsed * 0.004)) * 0.22;
        skullModel.position.y = -1.2 + bounce;
        skullModel.rotation.y = -0.58 + Math.sin(elapsed * 0.0012) * 0.2;
    }

    skullRenderer.render(skullScene, skullCamera);
}

function showStaticSkull() {
    skullGenerationFailed = true;
}

function startRevealObserver() {
    if (revealStarted) return;
    revealStarted = true;

    if (reduceMotion) {
        document.querySelectorAll(".reveal").forEach((el) => el.classList.add("show"));
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.classList.add("show");
                    }, 100);
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

function hideLoader() {
    if (loaderFinished) return;
    loaderFinished = true;
    console.log("[LOADER] hideLoader() appelé");
    window.clearTimeout(loaderSafetyTimer);
    cancelAnimationFrame(rafId);
    loader?.classList.add("hide");
    document.body.style.overflow = "";
    startRevealObserver();

    if (reduceMotion) {
        if (loader) loader.style.display = "none";
        return;
    }

    setTimeout(() => {
        if (loader) {
            loader.style.display = "none";
        }
    }, 1000);
}

function tick(now) {
    if (loaderFinished) return;
    if (!introStart) introStart = now;

    let elapsed = 0;
    let bar = 0;
    try {
        elapsed = now - introStart;
        renderSkullFrame(elapsed);

        if (elapsed >= INTRO_TYPE_START && !ghostStarted) {
            ghostCoder?.classList.add("visible");
            ghostStarted = true;
            console.log("[LOADER] ghost_coder visible à t=" + Math.round(elapsed) + "ms");
        }
        if (ghostStarted && !ghostFinished) {
            const typingElapsed = elapsed - INTRO_TYPE_START;
            const charIndex = Math.min(Math.floor(typingElapsed / GHOST_TYPE_SPEED), GHOST_TEXT.length);
            ghostText.textContent = GHOST_TEXT.slice(0, charIndex);
            if (charIndex >= GHOST_TEXT.length) {
                ghostFinished = true;
                console.log("[LOADER] ghost_coder complet à t=" + Math.round(elapsed) + "ms");
            }
        }

        const convergence = clamp01(elapsed / INTRO.converge);
        const hold = clamp01((elapsed - INTRO.converge) / INTRO.hold);
        const typing = clamp01((elapsed - INTRO_TYPE_START) / INTRO.type);
        const finish = clamp01((elapsed - INTRO_TYPE_END) / INTRO.finish);
        bar = convergence * 62 + hold * 8 + typing * 20 + finish * 10;

        if (elapsed >= INTRO_TOTAL_END) {
            ghostText.textContent = GHOST_TEXT;
            console.log("[LOADER] Introduction terminée à t=" + Math.round(elapsed) + "ms");
            setLoaderProgress(100);
            hideLoader();
            return;
        }

        setLoaderProgress(bar);
    } catch (err) {
        console.error("[LOADER] Erreur dans tick():", err);
        showStaticSkull();
        setLoaderProgress(bar);
    }

    rafId = requestAnimationFrame(tick);
}

function handleLoad() {
    pageLoaded = true;
    console.log("[LOADER] Événement 'load' reçu, pageLoaded=" + pageLoaded);

    if (loaderFinished) return;

    if (reduceMotion) {
        showStaticSkull();
        setLoaderProgress(100);
        hideLoader();
        return;
    }
}

function initLoader() {
    console.log("[LOADER] Démarrage de l'introduction (reduceMotion=" + reduceMotion + ")");
    window.addEventListener("load", handleLoad);

    if (reduceMotion) {
        showStaticSkull();
        ghostCoder?.classList.add("visible");
        ghostText.textContent = GHOST_TEXT;

        setLoaderProgress(pageLoaded ? 100 : 88);

        if (pageLoaded) {
            hideLoader();
        }
        return;
    }

    try {
        buildSkullFragments();
    } catch (error) {
        console.warn("[LOADER] Fragments du crâne indisponibles, SVG statique utilisé:", error.message);
        showStaticSkull();
    }

    introStart = performance.now();
    rafId = requestAnimationFrame(tick);
}

loaderSafetyTimer = setTimeout(() => {
    console.warn("[LOADER] Safety timer déclenché après 10s - forçage de la fin");
    forcedFinish = true;

    if (reduceMotion) {
        setLoaderProgress(100);
        hideLoader();
        return;
    }

    cancelAnimationFrame(rafId);
    ghostText.textContent = GHOST_TEXT;
    ghostCoder?.classList.add("visible");
    setLoaderProgress(100);
    hideLoader();
}, LOADER_FALLBACK_DELAY);

document.body.style.overflow = "hidden";
initLoader();

const cursor = document.querySelector(".cursor");
const cursorDot = document.querySelector(".cursor-dot");

function initCursor() {
    if (reduceMotion || window.matchMedia("(pointer: coarse)").matches) return;
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let currentX = targetX;
    let currentY = targetY;

    window.addEventListener("mousemove", (event) => {
        targetX = event.clientX;
        targetY = event.clientY;
    });

    (function follow() {
        currentX += (targetX - currentX) * 0.3;
        currentY += (targetY - currentY) * 0.3;
        if (cursorDot) {
            cursorDot.style.transform = `translate(${targetX}px, ${targetY}px) translate(-50%, -50%)`;
        }
        if (cursor) {
            cursor.style.transform = `translate(${currentX}px, ${currentY}px) translate(-50%, -50%)`;
        }
        requestAnimationFrame(follow);
    })();
}

initCursor();

function initCursorHover() {
    const interactive = document.querySelectorAll(
        'a, button, .project, .skill-card, .service-card, .contact-card, .nav-cta, .available, .text-link, .icon-link'
    );

    function addHover() {
        if (cursor) cursor.classList.add('hover');
        if (cursorDot) cursorDot.classList.add('hover');
    }

    function removeHover() {
        if (cursor) cursor.classList.remove('hover');
        if (cursorDot) cursorDot.classList.remove('hover');
    }

    interactive.forEach((el) => {
        el.addEventListener('mouseenter', addHover, { passive: true });
        el.addEventListener('mouseleave', removeHover, { passive: true });
    });
}

window.addEventListener('resize', () => {
    if (window.innerWidth > 1100 && fullscreenMenu?.classList.contains('open')) {
        closeMenu();
    }
}, { passive: true });

if (!reduceMotion) {
    initCursorHover();
}

// ============ SCROLL SPY ============

function initScrollSpy() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.menu-list a[href^="#"]');

    if (!sections.length || !navLinks.length) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    navLinks.forEach((link) => {
                        link.classList.toggle('active', link.getAttribute('href') === '#' + id);
                    });
                }
            });
        },
        { threshold: 0.15, rootMargin: '-10% 0px -70% 0px' }
    );

    sections.forEach((section) => observer.observe(section));
}

initScrollSpy();

// ============ BOUTON RETOUR EN HAUT ============

const scrollTopBtn = document.querySelector('.scroll-top');

function initScrollTop() {
    if (!scrollTopBtn) return;

    function updateVisibility() {
        if (window.scrollY > 300) {
            scrollTopBtn.classList.add('visible');
        } else {
            scrollTopBtn.classList.remove('visible');
        }
    }

    scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', updateVisibility, { passive: true });
    updateVisibility();
}

initScrollTop();

// ============ DÉLAIS REVEAL AUTOMATISÉS ============

function initRevealDelays() {
    const reveals = document.querySelectorAll('.reveal');
    const parentGroups = new Map();

    reveals.forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;

        if (!parentGroups.has(parent)) {
            parentGroups.set(parent, []);
        }
        parentGroups.get(parent).push(el);
    });

    parentGroups.forEach((els, parent) => {
        els.forEach((el, index) => {
            // Délai progressif : 60ms par élément dans le même parent
            el.style.transitionDelay = `${index * 0.06}s`;
        });
    });
}

initRevealDelays();

const progressBar = document.querySelector("#nprogress .bar");

function updateProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    if (progressBar) progressBar.style.width = `${pct}%`;
}

window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("load", updateProgress);
updateProgress();

// Reveals are started by the intro (hideLoader) so the portfolio appears in motion.

// ============ MENU PLEIN ÉCRAN ============

const menuToggle = document.querySelector(".menu-toggle");
const menuClose = document.querySelector(".menu-close");
const fullscreenMenu = document.querySelector("#fullscreen-menu");
const menuLinks = document.querySelectorAll(".menu-list a");
let menuRequestedOpen = false;
let menuTransitionId = 0;
let menuTransitionPromise = Promise.resolve();
let menuResizeTimer = 0;

function finishMenuClose(transitionId) {
    if (transitionId !== menuTransitionId || menuRequestedOpen) return;

    fullscreenMenu?.classList.remove("open");
    fullscreenMenu?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    menuReveal.finishImmediately(false);
    menuToggle?.focus({ preventScroll: true });
}

function transitionMenu(open, force = false) {
    if (!fullscreenMenu || (!force && open === menuRequestedOpen)) {
        return menuTransitionPromise;
    }

    menuRequestedOpen = open;
    const transitionId = ++menuTransitionId;
    menuReveal.cancelAnimations();

    menuToggle?.setAttribute("aria-expanded", String(open));
    menuClose?.setAttribute("aria-expanded", String(open));

    if (open) {
        menuReveal.prepareAssembly();
        fullscreenMenu.classList.add("open");
        fullscreenMenu.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";

        if (menuReveal.reducedMotion()) {
            menuReveal.finishImmediately(true);
            menuClose?.focus({ preventScroll: true });
            menuTransitionPromise = Promise.resolve();
            return menuTransitionPromise;
        }

        menuClose?.focus({ preventScroll: true });
        menuTransitionPromise = menuReveal
            .assemble(() => transitionId === menuTransitionId)
            .catch((error) => console.warn("[MENU REVEAL] Assemblage interrompu:", error));
        return menuTransitionPromise;
    }

    if (!fullscreenMenu.classList.contains("open")) {
        fullscreenMenu.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        menuReveal.finishImmediately(false);
        return Promise.resolve();
    }

    menuReveal.prepareDispersal();
    if (menuReveal.reducedMotion()) {
        finishMenuClose(transitionId);
        menuTransitionPromise = Promise.resolve();
        return menuTransitionPromise;
    }

    menuTransitionPromise = menuReveal
        .disperse(() => transitionId === menuTransitionId)
        .then(() => finishMenuClose(transitionId))
        .catch((error) => {
            console.warn("[MENU REVEAL] Dispersion interrompue:", error);
            finishMenuClose(transitionId);
        });
    return menuTransitionPromise;
}

function openMenu() {
    return transitionMenu(true);
}

function closeMenu() {
    return transitionMenu(false);
}

function toggleMenu() {
    transitionMenu(!menuRequestedOpen);
}

menuToggle?.addEventListener("click", toggleMenu);
menuClose?.addEventListener("click", closeMenu);

menuLinks.forEach((link) => {
    link.addEventListener("click", () => {
        closeMenu();
        const target = link.getAttribute("href");
        if (target && target.startsWith("#")) {
            const section = document.querySelector(target);
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    });
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuRequestedOpen) {
        closeMenu();
    }
});

window.addEventListener("resize", () => {
    window.clearTimeout(menuResizeTimer);
    menuResizeTimer = window.setTimeout(async () => {
        const overlayVisible = fullscreenMenu?.classList.contains("open");
        const targetOpen = menuRequestedOpen;
        const transitionId = ++menuTransitionId;
        menuReveal.cancelAnimations();

        try {
            await menuReveal.rebuild(overlayVisible && !targetOpen);
        } catch (error) {
            console.warn("[MENU REVEAL] Régénération après redimensionnement échouée:", error);
        }

        if (transitionId !== menuTransitionId || !overlayVisible) return;

        if (targetOpen) {
            menuReveal.prepareAssembly();
            if (menuReveal.reducedMotion()) {
                menuReveal.finishImmediately(true);
            } else {
                menuTransitionPromise = menuReveal.assemble(() => transitionId === menuTransitionId);
            }
        } else {
            menuReveal.prepareDispersal();
            if (menuReveal.reducedMotion()) {
                finishMenuClose(transitionId);
            } else {
                menuTransitionPromise = menuReveal
                    .disperse(() => transitionId === menuTransitionId)
                    .then(() => finishMenuClose(transitionId));
            }
        }
    }, 140);
}, { passive: true });

const menuMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
menuMotionPreference.addEventListener("change", () => {
    const transitionId = ++menuTransitionId;
    menuReveal.cancelAnimations();

    if (menuRequestedOpen) {
        fullscreenMenu?.classList.add("open");
        fullscreenMenu?.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        menuReveal.finishImmediately(true);
    } else if (fullscreenMenu?.classList.contains("open")) {
        finishMenuClose(transitionId);
    }
});

if (!reduceMotion) {
    let lastScroll = 0;

    window.addEventListener(
        "scroll",
        () => {
            const currentScroll = window.pageYOffset;
            if (currentScroll > 50) {
                header?.classList.add("scrolled");
            } else {
                header?.classList.remove("scrolled");
            }

            lastScroll = currentScroll;
        },
        { passive: true }
    );
}

form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    statusEl.classList.remove("error");

    if (!name || !email || !message) {
        statusEl.textContent = "Merci de renseigner votre nom, votre e-mail et un message.";
        statusEl.classList.add("error");
        return;
    }

    if (!emailOk) {
        statusEl.textContent = "L’adresse e-mail ne semble pas valide.";
        statusEl.classList.add("error");
        return;
    }

const subject = encodeURIComponent(`Contact portfolio — ${name}`);
const body = encodeURIComponent(`Nom : ${name}\nE-mail : ${email}\n\n${message}`);
statusEl.textContent = "Ouverture de votre application mail…";
window.location.href = `mailto:alylatyr@gmail.com?subject=${subject}&body=${message}`;
});

// ============ SVG FRAGMENT REVEAL ============

const menuReveal = (() => {
    const items = Array.from(document.querySelectorAll(".menu-item"));
    const svgNamespace = "http://www.w3.org/2000/svg";
    const columns = 9;
    const rows = 4;
    const activeAnimations = [];
    let buildPromise = Promise.resolve();

    function reducedMotion() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function makeRandom(seed) {
        let value = seed >>> 0;
        return () => {
            value = (1664525 * value + 1013904223) >>> 0;
            return value / 4294967296;
        };
    }

    function measureTitle(title, wrap) {
        const oldTransform = title.style.getPropertyValue("transform");
        const oldTransformPriority = title.style.getPropertyPriority("transform");
        const oldTransition = title.style.getPropertyValue("transition");
        const oldTransitionPriority = title.style.getPropertyPriority("transition");

        title.style.setProperty("transition", "none", "important");
        title.style.setProperty("transform", "none", "important");
        void title.getBoundingClientRect();

        const range = document.createRange();
        range.selectNodeContents(title);
        const rangeRect = range.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();

        if (oldTransform) {
            title.style.setProperty("transform", oldTransform, oldTransformPriority);
        } else {
            title.style.removeProperty("transform");
        }
        if (oldTransition) {
            title.style.setProperty("transition", oldTransition, oldTransitionPriority);
        } else {
            title.style.removeProperty("transition");
        }

        return {
            left: rangeRect.left - wrapRect.left,
            top: rangeRect.top - wrapRect.top,
            width: rangeRect.width,
            height: rangeRect.height,
        };
    }

    function copyTextStyles(source, destination) {
        const style = getComputedStyle(source);
        [
            "font-family",
            "font-size",
            "font-weight",
            "font-variation-settings",
            "font-stretch",
            "font-kerning",
            "font-feature-settings",
            "font-variant-ligatures",
            "letter-spacing",
        ].forEach((property) => {
            const value = style.getPropertyValue(property);
            if (value) destination.style.setProperty(property, value);
        });
        destination.setAttribute("fill", "#fff");
    }

    function makeGrid(bounds, seed) {
        const random = makeRandom(seed);
        const vertices = [];
        const cellWidth = bounds.width / columns;
        const cellHeight = bounds.height / rows;

        for (let row = 0; row <= rows; row++) {
            const vertexRow = [];
            for (let column = 0; column <= columns; column++) {
                const edge = row === 0 || row === rows || column === 0 || column === columns;
                const jitterX = edge ? 0 : (random() - 0.5) * cellWidth * 0.28;
                const jitterY = edge ? 0 : (random() - 0.5) * cellHeight * 0.28;
                vertexRow.push({
                    x: bounds.x + column * cellWidth + jitterX,
                    y: bounds.y + row * cellHeight + jitterY,
                });
            }
            vertices.push(vertexRow);
        }

        const cells = [];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                cells.push([
                    vertices[row][column],
                    vertices[row][column + 1],
                    vertices[row + 1][column + 1],
                    vertices[row + 1][column],
                ]);
            }
        }
        return cells;
    }

    function buildTitle(item, itemIndex, startAssembled) {
        const title = item.querySelector(".menu-title");
        const wrap = item.querySelector(".menu-title-wrap");
        const container = item.querySelector(".title-fragments");
        if (!title || !wrap || !container) return false;

        const geometry = measureTitle(title, wrap);
        const styles = getComputedStyle(title);
        const fontSize = parseFloat(styles.fontSize) || 40;
        const text = title.textContent.trim();
        if (!geometry.width || !geometry.height || !text) return false;

        container.replaceChildren();
        container.setAttribute("aria-hidden", "true");
        container.setAttribute("preserveAspectRatio", "none");
        container.style.inset = "auto";
        container.style.left = `${geometry.left}px`;
        container.style.top = `${geometry.top}px`;
        container.style.width = `${geometry.width}px`;
        container.style.height = `${geometry.height}px`;
        container.style.visibility = "hidden";
        container.style.opacity = "0";

        const defs = document.createElementNS(svgNamespace, "defs");
        const clip = document.createElementNS(svgNamespace, "clipPath");
        const clipId = `aly-reveal-mask-${itemIndex + 1}`;
        clip.setAttribute("id", clipId);
        clip.setAttribute("clipPathUnits", "userSpaceOnUse");

        const maskText = document.createElementNS(svgNamespace, "text");
        maskText.setAttribute("x", "0");
        maskText.setAttribute("y", `${fontSize}`);
        maskText.textContent = text;
        copyTextStyles(title, maskText);
        clip.appendChild(maskText);
        defs.appendChild(clip);
        container.appendChild(defs);

        const glyphBounds = maskText.getBBox();
        const textWidth = maskText.getComputedTextLength();
        if (!glyphBounds.width || !glyphBounds.height || Math.abs(textWidth - geometry.width) > 2.5) {
            container.replaceChildren();
            wrap.classList.remove("is-reconstructing");
            wrap.classList.add("is-revealed");
            return false;
        }

        container.style.width = `${glyphBounds.width}px`;
        container.style.height = `${glyphBounds.height}px`;
        container.setAttribute(
            "viewBox",
            `${glyphBounds.x} ${glyphBounds.y} ${glyphBounds.width} ${glyphBounds.height}`
        );

        const textHash = Array.from(text).reduce((hash, character) => hash + character.codePointAt(0), 0);
        const cells = makeGrid(glyphBounds, (itemIndex + 1) * 7919 + textHash);
        const scatterRandom = makeRandom((itemIndex + 1) * 104729 + textHash);
        const scatterX = Math.min(150, glyphBounds.width * 0.3);
        const scatterY = Math.min(72, glyphBounds.height * 0.55);

        cells.forEach((cell, fragmentIndex) => {
            const fragment = document.createElementNS(svgNamespace, "g");
            const polygon = document.createElementNS(svgNamespace, "polygon");
            const points = cell.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
            const offsetX = (scatterRandom() - 0.5) * scatterX * 2;
            const offsetY = (scatterRandom() - 0.5) * scatterY * 2;
            const rotation = (scatterRandom() - 0.5) * 64;
            const scale = 0.48 + scatterRandom() * 0.32;
            const scatterTransform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(2)})`;

            fragment.setAttribute("class", fragmentIndex % 5 === 0 ? "reveal-fragment fill-deep" : "reveal-fragment");
            fragment.setAttribute("clip-path", `url(#${clipId})`);
            fragment.dataset.scatterTransform = scatterTransform;
            fragment.style.transform = startAssembled ? "none" : scatterTransform;
            fragment.style.opacity = "1";
            polygon.setAttribute("points", points);
            fragment.appendChild(polygon);
            container.appendChild(fragment);
        });

        return true;
    }

    function cancelAnimations() {
        activeAnimations.splice(0).forEach((animation) => {
            const target = animation.effect?.target;
            if (target instanceof SVGElement) {
                const style = getComputedStyle(target);
                target.style.transform = style.transform;
                target.style.opacity = style.opacity;
            }
            animation.cancel();
        });
    }

    function animateFragment(fragment, targetTransform, delay, duration, isCurrent) {
        if (typeof fragment.animate !== "function") {
            fragment.style.transform = targetTransform;
            fragment.style.opacity = "1";
            return Promise.resolve();
        }

        const current = getComputedStyle(fragment);
        const animation = fragment.animate(
            [
                { transform: current.transform, opacity: current.opacity },
                { transform: targetTransform, opacity: "1" },
            ],
            { duration, delay, easing: "cubic-bezier(0.18, 0.72, 0.22, 1)", fill: "both" }
        );
        activeAnimations.push(animation);

        return animation.finished
            .then(() => {
                if (!isCurrent()) return;
                fragment.style.transform = targetTransform;
                fragment.style.opacity = "1";
                animation.cancel();
            })
            .catch(() => {})
            .finally(() => {
                const index = activeAnimations.indexOf(animation);
                if (index !== -1) activeAnimations.splice(index, 1);
            });
    }

    function fadeFragments(container, isCurrent) {
        if (typeof container.animate !== "function") {
            container.style.opacity = "0";
            container.style.visibility = "hidden";
            return Promise.resolve();
        }

        const animation = container.animate(
            [{ opacity: getComputedStyle(container).opacity }, { opacity: "0" }],
            { duration: 180, easing: "ease-out", fill: "both" }
        );
        activeAnimations.push(animation);

        return animation.finished
            .then(() => {
                if (!isCurrent()) return;
                container.style.opacity = "0";
                container.style.visibility = "hidden";
                animation.cancel();
            })
            .catch(() => {})
            .finally(() => {
                const index = activeAnimations.indexOf(animation);
                if (index !== -1) activeAnimations.splice(index, 1);
            });
    }

    function revealTitle(item, isCurrent) {
        if (!isCurrent()) return Promise.resolve();
        const wrap = item.querySelector(".menu-title-wrap");
        const container = item.querySelector(".title-fragments");
        wrap?.classList.remove("is-reconstructing");
        wrap?.classList.add("is-revealed");
        return container ? fadeFragments(container, isCurrent) : Promise.resolve();
    }

    function prepareAssembly() {
        if (reducedMotion()) {
            finishImmediately(true);
            return;
        }
        items.forEach((item) => {
            const wrap = item.querySelector(".menu-title-wrap");
            const container = item.querySelector(".title-fragments");
            wrap?.classList.remove("is-revealed");
            wrap?.classList.add("is-reconstructing");
            if (container) {
                container.style.visibility = "visible";
                container.style.opacity = "1";
            }
        });
    }

    function prepareDispersal() {
        if (reducedMotion()) return;
        items.forEach((item) => {
            const wrap = item.querySelector(".menu-title-wrap");
            const container = item.querySelector(".title-fragments");
            wrap?.classList.remove("is-revealed");
            wrap?.classList.add("is-reconstructing");
            if (container) {
                container.style.visibility = "visible";
                container.style.opacity = "1";
            }
        });
    }

    function finishImmediately(open) {
        items.forEach((item) => {
            const wrap = item.querySelector(".menu-title-wrap");
            const container = item.querySelector(".title-fragments");
            const fragments = item.querySelectorAll(".reveal-fragment");
            if (open) {
                wrap?.classList.remove("is-reconstructing");
                wrap?.classList.add("is-revealed");
            } else {
                wrap?.classList.remove("is-reconstructing", "is-revealed");
            }
            if (container) {
                container.style.visibility = "hidden";
                container.style.opacity = "0";
            }
            fragments.forEach((fragment) => {
                fragment.style.transform = open ? "none" : fragment.dataset.scatterTransform;
                fragment.style.opacity = "1";
            });
        });
    }

    async function rebuild(startAssembled = false) {
        if (document.fonts?.ready) {
            await document.fonts.ready.catch(() => {});
        }
        items.forEach((item, index) => {
            try {
                buildTitle(item, index, startAssembled);
            } catch (error) {
                const wrap = item.querySelector(".menu-title-wrap");
                const container = item.querySelector(".title-fragments");
                console.warn(`[MENU REVEAL] Titre ${index + 1} en fallback:`, error.message);
                container?.replaceChildren();
                if (container) container.style.visibility = "hidden";
                wrap?.classList.remove("is-reconstructing");
                wrap?.classList.add("is-revealed");
            }
        });
    }

    async function assemble(isCurrent = () => true) {
        await buildPromise;
        if (!isCurrent()) return;
        if (reducedMotion()) {
            finishImmediately(true);
            return;
        }

        prepareAssembly();
        await Promise.all(items.map(async (item, itemIndex) => {
            const fragments = Array.from(item.querySelectorAll(".reveal-fragment"));
            if (!fragments.length) {
                await revealTitle(item, isCurrent);
                return;
            }
            await Promise.all(fragments.map((fragment, fragmentIndex) =>
                animateFragment(fragment, "none", itemIndex * 115 + fragmentIndex * 3, 650, isCurrent)
            ));
            await revealTitle(item, isCurrent);
        }));
    }

    async function disperse(isCurrent = () => true) {
        await buildPromise;
        if (!isCurrent() || reducedMotion()) return;

        await Promise.all(items.map(async (item, itemIndex) => {
            const fragments = Array.from(item.querySelectorAll(".reveal-fragment"));
            const reverseIndex = items.length - itemIndex - 1;
            await Promise.all(fragments.map((fragment, fragmentIndex) =>
                animateFragment(
                    fragment,
                    fragment.dataset.scatterTransform,
                    reverseIndex * 90 + fragmentIndex * 3,
                    540,
                    isCurrent
                )
            ));
        }));
    }

    buildPromise = rebuild(false);

    return {
        assemble,
        cancelAnimations,
        disperse,
        finishImmediately,
        prepareAssembly,
        prepareDispersal,
        rebuild,
        reducedMotion,
    };
})();

// ============ PROJECT CUBE NAVIGATION ============

(function initProjectCube() {
    const gallery = document.querySelector(".project-gallery");
    const cube = document.querySelector("#project-cube");
    const faces = Array.from(cube?.querySelectorAll(".cube-face") || []);
    const indicators = Array.from(document.querySelectorAll("[data-cube-index]"));
    const previousButton = document.querySelector("[data-cube-previous]");
    const nextButton = document.querySelector("[data-cube-next]");
    const status = document.querySelector("[data-cube-status]");

    if (!gallery || !cube || faces.length !== 6 || indicators.length !== 6) return;

    const orientations = [
        { x: 0, y: 0 },
        { x: 0, y: -90 },
        { x: 0, y: -180 },
        { x: 0, y: -270 },
        { x: -90, y: 0 },
        { x: 90, y: 0 },
    ];
    let activeIndex = 0;

    cube.setAttribute("role", "group");
    cube.setAttribute("aria-roledescription", "cube 3D");

    function setActiveProject(nextIndex) {
        const normalizedIndex = (nextIndex + faces.length) % faces.length;
        if (normalizedIndex === activeIndex) return;

        faces[activeIndex].querySelectorAll("video").forEach((video) => video.pause());
        activeIndex = normalizedIndex;

        const orientation = orientations[activeIndex];
        cube.style.transform = `rotateX(-4deg) rotateY(-16deg) rotateX(${orientation.x}deg) rotateY(${orientation.y}deg)`;

        faces.forEach((face, index) => {
            const active = index === activeIndex;
            face.toggleAttribute("inert", !active);
            face.setAttribute("aria-hidden", String(!active));
        });

        indicators.forEach((indicator, index) => {
            if (index === activeIndex) {
                indicator.setAttribute("aria-current", "true");
            } else {
                indicator.removeAttribute("aria-current");
            }
        });

        const title = faces[activeIndex].querySelector(".project-meta h3")?.textContent.trim();
        if (status && title) {
            status.textContent = `Projet ${activeIndex + 1} sur ${faces.length} : ${title}`;
        }
    }

    faces.forEach((face, index) => {
        face.toggleAttribute("inert", index !== activeIndex);
        face.setAttribute("aria-hidden", String(index !== activeIndex));
    });

    previousButton?.addEventListener("click", () => setActiveProject(activeIndex - 1));
    nextButton?.addEventListener("click", () => setActiveProject(activeIndex + 1));
    indicators.forEach((indicator) => {
        indicator.addEventListener("click", () => {
            setActiveProject(Number(indicator.dataset.cubeIndex));
        });
    });
})();
