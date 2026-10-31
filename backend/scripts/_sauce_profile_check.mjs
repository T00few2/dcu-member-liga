/**
 * Diagnostic: Sauce curve elevation versus zwift-data grades.
 * Uses the extracted Sauce curve module. Not part of the app.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as Curves from "./_sauce_curves.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const worldlist = JSON.parse(fs.readFileSync(path.join(root, "worldlist.json"), "utf8"));
const routes = JSON.parse(fs.readFileSync(path.join(root, "routes.json"), "utf8"));
const roadsByWorld = new Map();

function worldMeta(route) {
    return worldlist.find(
        (world) => world.worldId === route.worldId || world.courseId === route.courseId,
    );
}

function zToAltitude(meta, z) {
    const scale = meta?.physicsSlopeScale || 1;
    const seaLevel = meta?.seaLevel || 0;
    const elOffset = meta?.eleOffset || 0;
    return ((z - seaLevel + elOffset) / 100) * scale;
}

function roads(worldId) {
    if (!roadsByWorld.has(worldId)) {
        const rows = JSON.parse(
            fs.readFileSync(path.join(root, "worlds", String(worldId), "roads.json"), "utf8"),
        );
        roadsByWorld.set(worldId, new Map(rows.map((road) => [road.id, road])));
    }
    return roadsByWorld.get(worldId);
}

const curveCache = new Map();
function curveFor(worldId, roadId) {
    const key = `${worldId}:${roadId}`;
    if (!curveCache.has(key)) {
        const road = roads(worldId).get(roadId);
        const build = road.splineType === "Bezier" ? Curves.cubicBezierPath : Curves.catmullRomPath;
        curveCache.set(key, build(road.path, { loop: !!road.looped, road: true }));
    }
    return curveCache.get(key);
}

function supplement(meta, curvePath) {
    const elevations = [];
    const distances = [];
    let prevIndex;
    let distance = 0;
    let prevNode;
    curvePath.trace((step) => {
        distance += prevNode ? Curves.vecDist(prevNode, step.stepNode) / 100 : 0;
        if (step.index !== prevIndex) {
            elevations.push(zToAltitude(meta, step.stepNode[2]));
            distances.push(distance);
            prevIndex = step.index;
        }
        prevNode = step.stepNode;
    }, 1 / 250);
    return { elevations, distances };
}

function slicePath(curve, start, end) {
    const reverse = start > end;
    const sub = curve.subpathAtRoadPercents(Math.min(start, end), Math.max(start, end));
    return reverse ? sub.toReversed() : sub;
}

function stats(meta, curve, start, end) {
    const sampled = supplement(meta, slicePath(curve, start, end));
    const elevations = sampled.elevations;
    const distances = sampled.distances;
    if (elevations.length < 2) return null;
    const length = distances.at(-1) - distances[0];
    const net = elevations.at(-1) - elevations[0];
    let ascent = 0;
    for (let i = 1; i < elevations.length; i++) {
        const dz = elevations[i] - elevations[i - 1];
        if (dz > 0) ascent += dz;
    }
    return {
        length: length,
        net,
        ascent,
        grade: length > 1 ? (net / length) * 100 : null,
    };
}

function segments(worldId) {
    const file = path.join(root, "worlds", String(worldId), "segments.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

const listed = new Set();
for (const route of routes) {
    for (const entry of route.segments || []) {
        if (entry && entry.id != null && !entry.leadinOnly && !(entry.offset < 0)) {
            listed.add(String(entry.id));
        }
    }
}

const segById = new Map();
for (const world of worldlist) {
    const file = path.join(root, "worlds", String(world.worldId), "segments.json");
    if (!fs.existsSync(file)) continue;
    for (const segment of segments(world.worldId)) {
        if (segment.idForward != null) segById.set(String(segment.idForward), { segment, direction: "forward", world });
        if (segment.idReverse != null) segById.set(String(segment.idReverse), { segment, direction: "reverse", world });
    }
}

const text = await (await fetch("https://unpkg.com/zwift-data@2.1.1/lib/segments.js")).text();
const holder = { segments: null };
eval(text.replace("export const segments =", "holder.segments ="));

function norm(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/\brev(erse)?\.?\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

const catalogByName = new Map();
for (const item of holder.segments) {
    const reverse = /\brev/i.test(item.slug) || /\brev/i.test(item.name);
    catalogByName.set(`${norm(item.name)}|${reverse ? "R" : "F"}`, item);
}

const rows = [];
for (const id of listed) {
    const found = segById.get(id);
    if (!found) continue;
    const { segment, direction, world } = found;
    if (segment.archId == null || segment.requiresAllCheckpoints) continue;
    const name = direction === "reverse" ? segment.nameReverse || segment.nameForward : segment.nameForward;
    const start = direction === "reverse" ? segment.roadStartReverse : segment.roadStartForward;
    const end = segment.roadFinish;
    if (start == null || end == null || !name) continue;
    const curve = curveFor(world.worldId, segment.roadId);
    const measured = stats(world, curve, Number(start), Number(end));
    if (!measured || measured.grade == null) continue;
    const catalogItem = catalogByName.get(`${norm(name)}|${direction === "reverse" ? "R" : "F"}`);
    rows.push({
        name,
        direction,
        world: world.name,
        grade: measured.grade,
        net: measured.net,
        ascent: measured.ascent,
        length: measured.length,
        catalogType: catalogItem?.type || null,
        catalogIncline: catalogItem?.avgIncline ?? null,
        catalogDistance: catalogItem?.distance ?? null,
    });
}

const named = [
    "Titans Grove KOM",
    "Titans Grove KOM Reverse",
    "Alpe du Zwift",
    "Epic KOM",
    "Zwift KOM",
    "The Grade",
    "Brooklyn Bridge KOM",
    "Manhattan Sprint",
];
console.log("named segments");
for (const name of named) {
    const row = rows.find((item) => item.name === name) || rows.find((item) => item.name && item.name.trim() === name);
    console.log(name, row ? JSON.stringify({
        grade: +row.grade.toFixed(2),
        net: +row.net.toFixed(1),
        ascent: +row.ascent.toFixed(1),
        length: +row.length.toFixed(0),
        catalog: row.catalogIncline,
        type: row.catalogType,
    }) : "MISSING");
}

const comparable = rows.filter((row) => row.catalogIncline != null);
let abs = 0;
let worst = [];
for (const row of comparable) {
    const err = Math.abs(row.grade - row.catalogIncline);
    abs += err;
    worst.push({ err, name: row.name, grade: +row.grade.toFixed(2), catalog: row.catalogIncline, type: row.catalogType });
}
worst.sort((a, b) => b.err - a.err);
console.log("\ncompared", comparable.length, "mean abs grade error", +(abs / comparable.length).toFixed(2));
console.log("worst");
for (const row of worst.slice(0, 15)) console.log(JSON.stringify(row));

let climbAsSprint = 0;
let sprintAsClimb = 0;
let climb = 0;
let sprint = 0;
for (const row of rows) {
    if (row.catalogType !== "climb" && row.catalogType !== "sprint") continue;
    const predicted = row.grade >= 2 ? "climb" : "sprint";
    if (row.catalogType === "climb") climb += 1;
    else sprint += 1;
    if (predicted !== row.catalogType) {
        if (row.catalogType === "climb") climbAsSprint += 1;
        else sprintAsClimb += 1;
    }
}
console.log("\nthreshold 2% on route-listed segments");
console.log({ climb, sprint, climbAsSprint, sprintAsClimb });
for (const row of rows) {
    if (row.catalogType !== "climb" && row.catalogType !== "sprint") continue;
    const predicted = row.grade >= 2 ? "climb" : "sprint";
    if (predicted !== row.catalogType) {
        console.log("mislabel", row.catalogType, "as", predicted, row.name, +row.grade.toFixed(2), "catalog", row.catalogIncline);
    }
}

const focusRoutes = ["Road to Sky", "Sand And Sequoias", "Ven-Top", "Three Little Sisters"];
console.log("\nroutes");
for (const route of routes) {
    if (!focusRoutes.includes(route.name)) continue;
    const meta = worldMeta(route);
    let length = 0;
    let ascent = 0;
    let net = 0;
    let startEl = null;
    let endEl = null;
    for (const entry of route.manifest || []) {
        if (entry.leadin) continue;
        const curve = curveFor(route.worldId, entry.roadId);
        const start = Number(entry.start);
        const end = Number(entry.end);
        const reverse = !!entry.reverse;
        const sub = curve.subpathAtRoadPercents(Math.min(start, end), Math.max(start, end));
        const sampled = supplement(meta, reverse || start > end ? sub.toReversed() : sub);
        if (sampled.elevations.length < 2) continue;
        if (startEl == null) startEl = sampled.elevations[0];
        endEl = sampled.elevations.at(-1);
        length += sampled.distances.at(-1);
        for (let i = 1; i < sampled.elevations.length; i++) {
            const dz = sampled.elevations[i] - sampled.elevations[i - 1];
            if (dz > 0) ascent += dz;
            net += dz;
        }
    }
    console.log(route.name, {
        sauceKm: +(length / 1000).toFixed(2),
        officialKm: +((route.distanceInMeters || 0) / 1000).toFixed(2),
        sauceAscent: +ascent.toFixed(0),
        officialAscent: Math.round(route.ascentInMeters || 0),
        net: +net.toFixed(0),
    });
}
