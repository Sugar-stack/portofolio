/* ============ ALY DIGITAL FLOW ============ */
/* Interactive topographic curves + digital network, Canvas 2D. */

(() => {
    "use strict";

    const canvas = document.getElementById("flow-canvas");

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d", { alpha: true });

    if (!ctx) {
        document.documentElement.classList.add("no-flow");
        return;
    }

    const TAU = Math.PI * 2;
    const mq = (query) =>
        typeof window.matchMedia === "function"
            ? window.matchMedia(query).matches
            : false;
    const reducedMotion = mq("(prefers-reduced-motion: reduce)");
    const coarse = mq("(pointer: coarse)");

    const pointer = {
        x: 0,
        y: 0,
        tx: 0,
        ty: 0,
        active: false,
        lastMove: 0,
    };

    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    const ripples = [];
    const MAX_RIPPLES = 3;

    const quality = {
        dpr: 1,
        curves: 9,
        samples: 64,
        nodes: 64,
        linkDist: 130,
    };

    const contours = [];
    const nodes = [];
    let curveColors = [];
    let curveGlow = [];
    let pointerGradient = null;
    let pointerCore = null;
    let rippleCooldown = 0;
    let rafId = 0;
    let running = false;
    let lastFrame = 0;
    let width = 0;
    let height = 0;

    function computeQuality() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const small = vw < 720;
        const mid = vw < 1200;
        const maxPixels = 3400000;
        const budgetDpr = Math.sqrt(maxPixels / Math.max(1, vw * vh));

        quality.dpr = Math.min(
            window.devicePixelRatio || 1,
            small || coarse ? 1.25 : 1.5,
            budgetDpr
        );
        quality.curves = small ? 6 : mid ? 8 : 9;
        quality.samples = small ? 44 : mid ? 56 : 64;
        quality.nodes = small ? 30 : mid ? 46 : 64;
        quality.linkDist = small ? 102 : 116;

        if (coarse) {
            quality.curves = Math.min(quality.curves, 5);
            quality.nodes = Math.min(quality.nodes, 26);
        }

        if ((navigator.hardwareConcurrency || 4) <= 4) {
            quality.nodes = Math.min(quality.nodes, 40);
            quality.samples = Math.min(quality.samples, 52);
        }
    }

    function seedContours() {
        contours.length = 0;

        const small = width < 720;

        // Contour "islands" kept on the outer thirds, away from copy.
        contours.push({
            nx: small ? 0.82 : 0.87,
            ny: small ? 0.16 : 0.2,
            scale: small ? 0.5 : 1.05,
            rings: small ? 2 : 3,
            rx: 78,
            squash: 0.62,
            parallax: 1.2,
        });

        contours.push({
            nx: small ? 0.1 : 0.09,
            ny: small ? 0.82 : 0.78,
            scale: small ? 0.46 : 0.95,
            rings: small ? 2 : 3,
            rx: 66,
            squash: 0.78,
            parallax: 0.9,
        });

        // Third island clipped by the right edge: reads as a motif, not a blob.
        contours.push({
            nx: small ? 0.96 : 1.01,
            ny: small ? 0.52 : 0.55,
            scale: small ? 0.42 : 0.9,
            rings: small ? 2 : 3,
            rx: 82,
            squash: 0.9,
            parallax: 1.5,
        });
    }

    function buildColors() {
        curveColors = [];
        curveGlow = [];

        const indexLine = Math.min(quality.curves - 1, 4);

        for (let c = 0; c < quality.curves; c++) {
            // Two thirds accent-deep, one third accent: visible depth variation.
            const rgb = c % 3 === 1 ? "112, 123, 160" : "139, 152, 184";
            let alpha = 0.2 + Math.min(c, 7) * 0.015;

            if (c === indexLine) {
                alpha *= 1.55;
            }

            const shades = [alpha * 0.74, alpha, alpha * 1.2];

            curveColors.push(
                shades.map((a) => `rgba(${rgb}, ${Math.min(a, 0.5).toFixed(3)})`)
            );
            curveGlow.push(`rgba(96, 104, 135, ${(alpha * 0.4).toFixed(3)})`);
        }
    }

    function seedNodes() {
        nodes.length = 0;

        const clusters = [
            { x: 0.07, y: 0.28, r: 0.12 },
            { x: 0.93, y: 0.42, r: 0.13 },
            { x: 0.11, y: 0.8, r: 0.11 },
        ];

        for (let i = 0; i < quality.nodes; i++) {
            let nx;
            let ny;

            if (i % 4 !== 3) {
                // Round-robin keeps the three clusters balanced on every load.
                const cl = clusters[i % clusters.length];
                nx = cl.x + (Math.random() - 0.5) * cl.r * 2.2;
                ny = cl.y + (Math.random() - 0.5) * cl.r * 2.6;
            } else {
                nx = Math.random();
                ny = Math.random();
            }

            // Soft clamp: never stack nodes on the viewport edge.
            if (nx < 0.02) {
                nx = 0.02 + Math.random() * 0.05;
            } else if (nx > 0.98) {
                nx = 0.98 - Math.random() * 0.05;
            }

            if (ny < 0.03) {
                ny = 0.03 + Math.random() * 0.05;
            } else if (ny > 0.97) {
                ny = 0.97 - Math.random() * 0.05;
            }

            const bright = i % 9 === 0;

            nodes.push({
                nx,
                ny,
                r: bright ? 1.5 + Math.random() * 1.2 : 0.9 + Math.random() * 1.4,
                bright,
                seed: Math.random() * TAU * 8,
                x: 0,
                y: 0,
                glow: 0,
            });
        }
    }

    function resize() {
        computeQuality();

        width = window.innerWidth;
        height = window.innerHeight;

        canvas.width = Math.round(width * quality.dpr);
        canvas.height = Math.round(height * quality.dpr);

        ctx.setTransform(quality.dpr, 0, 0, quality.dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        pointerGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 280);
        pointerGradient.addColorStop(0, "rgba(139, 152, 184, 0.2)");
        pointerGradient.addColorStop(0.45, "rgba(112, 123, 160, 0.075)");
        pointerGradient.addColorStop(1, "rgba(96, 104, 135, 0)");

        pointerCore = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
        pointerCore.addColorStop(0, "rgba(196, 206, 232, 0.14)");
        pointerCore.addColorStop(1, "rgba(139, 152, 184, 0)");

        buildColors();
        seedNodes();
        seedContours();

        if (!pointer.active) {
            pointer.x = pointer.tx = width * 0.5;
            pointer.y = pointer.ty = height * 0.5;
        }

        if (reducedMotion) {
            draw(0, 0);
        }
    }

    function drawGeometry(t) {
        const small = width < 720;

        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.translate(
            width * (small ? 0.86 : 0.9) + parallax.x * 0.8,
            height * 0.86 + parallax.y * 0.8
        );
        ctx.rotate(-t * 0.04 + 0.35);
        ctx.strokeStyle = "rgba(139, 152, 184, 0.16)";

        ctx.beginPath();
        ctx.rect(-46, -46, 92, 92);
        ctx.stroke();

        ctx.beginPath();
        ctx.rect(-30, -30, 60, 60);
        ctx.stroke();

        ctx.restore();
    }

    function drawContours(t) {
        const steps = quality.samples;
        ctx.lineWidth = 1.2;

        for (let i = 0; i < contours.length; i++) {
            const shape = contours[i];
            const cx = shape.nx * width + parallax.x * shape.parallax;
            const cy = shape.ny * height + parallax.y * shape.parallax;

            for (let r = 0; r < shape.rings; r++) {
                const radius = shape.rx * shape.scale * (1 + r * 0.42);
                const alpha = 0.18 + r * 0.05;

                ctx.beginPath();

                for (let s = 0; s <= steps; s++) {
                    const a = (s / steps) * TAU;
                    const wobble =
                        1 +
                        Math.sin(a * 3 + t * 0.12 + r * 0.9) * 0.14 +
                        Math.sin(a * 5 - t * 0.16 + r) * 0.06;

                    const x = cx + Math.cos(a) * radius * wobble;
                    const y = cy + Math.sin(a) * radius * shape.squash * wobble;

                    if (s === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }

                ctx.strokeStyle = `rgba(139, 152, 184, ${alpha.toFixed(3)})`;
                ctx.stroke();
            }
        }
    }

    function drawCurves(t, now) {
        const interactive = !coarse && pointer.active;
        const radius = 320;
        const radius2 = radius * radius;
        const px = pointer.x;
        const py = pointer.y;
        const last = Math.max(1, quality.curves - 1);
        const centerY = height * 0.5;
        const indexLine = Math.min(quality.curves - 1, 4);

        for (let c = 0; c < quality.curves; c++) {
            const offset = (c / last - 0.5) * height * 0.82;
            const amp = 20 + (c % 3) * 11;
            const phase = c * 1.35 + t * 0.12;
            const drift = Math.sin(t * 0.2 + c * 1.1) * 9;
            const base = centerY + offset + Math.sin(c * 0.9 + t * 0.09) * 12;

            ctx.beginPath();

            for (let s = 0; s <= quality.samples; s++) {
                const x = (s / quality.samples) * width;

                // Vertical spacing breathing: dense clusters and open gaps.
                let env =
                    0.76 +
                    Math.sin(x * 0.0016 + t * 0.035 + 0.9) * 0.3 +
                    Math.sin(x * 0.0034 - t * 0.05 + 2.1) * 0.13;

                env = env < 0.52 ? 0.52 : env > 1.18 ? 1.18 : env;

                let y =
                    centerY +
                    (base - centerY) * env +
                    Math.sin(x * (0.0015 + c * 0.00017) + phase) * amp +
                    Math.sin(x * (0.0037 + c * 0.00021) - phase * 0.7) * amp * 0.52 +
                    Math.sin(x * (0.0081 + c * 0.00013) + phase * 1.4) * amp * 0.26 +
                    drift;

                let drawX = x;

                if (interactive) {
                    const dx = x - px;
                    const dy = y - py;
                    const d2 = dx * dx + dy * dy;

                    if (d2 < radius2) {
                        const d = Math.sqrt(d2) || 1;
                        let k = 1 - d / radius;
                        k = k * k * (3 - 2 * k);
                        // tanh keeps the push smooth across the pointer's axis.
                        y += Math.tanh(dy / 46) * k * 80;
                        y += Math.sin(d * 0.026 - t * 2.2) * k * 15;
                        drawX -= (dx / d) * k * 12;
                    }
                }

                for (let ri = 0; ri < ripples.length; ri++) {
                    const rp = ripples[ri];
                    const age = now - rp.born;
                    const ringRadius = age * 0.26;
                    const rdx = x - rp.x;
                    const rdy = y - rp.y;
                    const rd = Math.sqrt(rdx * rdx + rdy * rdy) || 1;
                    const band = Math.abs(rd - ringRadius);

                    if (band < 110) {
                        const kk = (1 - band / 110) * rp.force * Math.max(0, 1 - age / 2600);
                        y += (rdy / rd) * kk * 30;
                    }
                }

                const drawY = y + parallax.y * (0.35 + c * 0.06);
                drawX += parallax.x * (0.35 + c * 0.06);

                if (s === 0) {
                    ctx.moveTo(drawX, drawY);
                } else {
                    ctx.lineTo(drawX, drawY);
                }
            }

            const shade = ((Math.sin(t * 0.42 + c * 0.9) * 0.5 + 0.5) * 2.999) | 0;

            // Soft accent halo, then the crisp contour line.
            ctx.strokeStyle = curveGlow[c];
            ctx.lineWidth = 3.6;
            ctx.stroke();

            ctx.strokeStyle = curveColors[c][shade];
            ctx.lineWidth = c === indexLine ? 1.8 : c % 4 === 0 ? 1.5 : 1.1;
            ctx.stroke();
        }
    }

    function drawNetwork(t) {
        const interactive = !coarse && pointer.active;
        const linkDist = quality.linkDist;
        const linkDist2 = linkDist * linkDist;
        const nearDist = linkDist * 0.52;
        const nearDist2 = nearDist * nearDist;
        const reach = 180;
        const reach2 = reach * reach;
        const px = pointer.x;
        const py = pointer.y;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            let x = (node.nx + Math.sin(t * 0.1 + node.seed) * 0.011) * width;
            let y = (node.ny + Math.cos(t * 0.08 + node.seed * 1.7) * 0.011) * height;
            let glow = 0;

            if (interactive) {
                const dx = x - px;
                const dy = y - py;
                const d2 = dx * dx + dy * dy;

                if (d2 < reach2) {
                    const d = Math.sqrt(d2) || 1;
                    glow = 1 - d / reach;
                    glow *= glow;
                    x += (dx / d) * (glow * 30 + 6);
                    y += (dy / d) * (glow * 30 + 6);
                }
            }

            node.x = x;
            node.y = y;
            node.glow = glow;
        }

        // Long links: calm structure.
        ctx.beginPath();

        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];

            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const d2 = dx * dx + dy * dy;

                if (d2 < linkDist2 && d2 >= nearDist2) {
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
            }
        }

        ctx.strokeStyle = "rgba(139, 152, 184, 0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Short links: denser fabric.
        ctx.beginPath();

        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];

            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const d2 = dx * dx + dy * dy;

                if (d2 < nearDist2) {
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
            }
        }

        ctx.strokeStyle = "rgba(139, 152, 184, 0.3)";
        ctx.stroke();

        // Links touching a reacted node light up with the pointer.
        if (interactive) {
            ctx.beginPath();

            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];

                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j];

                    if (a.glow < 0.02 && b.glow < 0.02) {
                        continue;
                    }

                    const dx = a.x - b.x;
                    const dy = a.y - b.y;

                    if (dx * dx + dy * dy < linkDist2) {
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    }
                }
            }

            ctx.strokeStyle = "rgba(196, 206, 232, 0.45)";
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        ctx.beginPath();

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const pulse = node.bright ? 0.5 + Math.sin(t * 1.1 + node.seed) * 0.5 : 0;
            const dot = node.r + node.glow * 2.4 + pulse * 0.8;
            ctx.moveTo(node.x + dot, node.y);
            ctx.arc(node.x, node.y, dot, 0, TAU);
        }

        ctx.fillStyle = "rgba(166, 178, 210, 0.78)";
        ctx.fill();

        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(200, 210, 238, 1)";

        // Permanent twinkles: the network stays alive without the pointer.
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            if (!node.bright) {
                continue;
            }

            const pulse = 0.5 + Math.sin(t * 1.1 + node.seed) * 0.5;
            ctx.globalAlpha = 0.1 + pulse * 0.22;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r + 3 + pulse * 3.5, 0, TAU);
            ctx.fill();
        }

        if (interactive) {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];

                if (node.glow > 0.02) {
                    ctx.globalAlpha = node.glow * 0.6;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.r + 11 * node.glow, 0, TAU);
                    ctx.fill();
                }
            }
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }

    function drawRippleRings(now) {
        if (!ripples.length) {
            return;
        }

        const steps = coarse ? 36 : 56;
        ctx.lineWidth = 1.4;

        for (let i = 0; i < ripples.length; i++) {
            const rp = ripples[i];
            const age = now - rp.born;
            const alpha = Math.max(0, 1 - age / 2600) * 0.3 * rp.force;

            if (alpha <= 0.001) {
                continue;
            }

            const radius = age * 0.26;
            const seed = rp.born * 0.001;

            ctx.strokeStyle = `rgba(166, 178, 210, ${alpha.toFixed(3)})`;
            ctx.beginPath();

            for (let s = 0; s <= steps; s++) {
                const a = (s / steps) * TAU;
                const wobble =
                    1 +
                    Math.sin(a * 3 + seed) * 0.035 +
                    Math.sin(a * 5 - age * 0.0012) * 0.018;
                const x = rp.x + Math.cos(a) * radius * wobble;
                const y = rp.y + Math.sin(a) * radius * wobble;

                if (s === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        }
    }

    function drawPointerGlow() {
        if (coarse || !pointer.active) {
            return;
        }

        ctx.save();
        ctx.translate(pointer.x, pointer.y);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = pointerGradient;
        ctx.fillRect(-280, -280, 560, 560);
        ctx.fillStyle = pointerCore;
        ctx.fillRect(-70, -70, 140, 140);
        ctx.restore();
    }

    function draw(t, now) {
        ctx.clearRect(0, 0, width, height);
        drawGeometry(t);
        drawContours(t);
        drawCurves(t, now);
        drawNetwork(t);
        drawRippleRings(now);
        drawPointerGlow();
    }

    function updateRipples(now) {
        for (let i = ripples.length - 1; i >= 0; i--) {
            if (now - ripples[i].born > 2600) {
                ripples.splice(i, 1);
            }
        }
    }

    function frame(now) {
        rafId = requestAnimationFrame(frame);

        const interval = coarse ? 1000 / 30 : 1000 / 45;

        if (now - lastFrame < interval) {
            return;
        }

        lastFrame = now;

        pointer.x += (pointer.tx - pointer.x) * 0.12;
        pointer.y += (pointer.ty - pointer.y) * 0.12;

        parallax.tx = (pointer.x / Math.max(1, width) - 0.5) * -22;
        parallax.ty = (pointer.y / Math.max(1, height) - 0.5) * -14;
        parallax.x += (parallax.tx - parallax.x) * 0.05;
        parallax.y += (parallax.ty - parallax.y) * 0.05;

        updateRipples(now);
        draw(now * 0.001, now);
    }

    function start() {
        if (reducedMotion || running) {
            return;
        }

        running = true;
        lastFrame = 0;
        rafId = requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(rafId);
    }

    function onPointerMove(event) {
        const now = performance.now();
        const dist = Math.hypot(event.clientX - pointer.tx, event.clientY - pointer.ty);
        const dt = Math.max(8, now - pointer.lastMove);
        const speed = dist / dt;

        pointer.tx = event.clientX;
        pointer.ty = event.clientY;
        pointer.active = true;
        pointer.lastMove = now;

        if (speed > 0.45 && now - rippleCooldown > 260 && ripples.length < MAX_RIPPLES) {
            rippleCooldown = now;
            ripples.push({
                x: pointer.tx,
                y: pointer.ty,
                born: now,
                force: Math.min(1, speed),
            });
        }
    }

    window.addEventListener("resize", resize, { passive: true });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stop();
        } else {
            start();
        }
    });

    if (!coarse && !reducedMotion) {
        window.addEventListener("mousemove", onPointerMove, { passive: true });
        window.addEventListener("mouseleave", () => {
            pointer.active = false;
        }, { passive: true });
    }

    resize();

    if (!reducedMotion) {
        start();
    }
})();
