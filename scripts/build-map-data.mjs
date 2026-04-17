import fs from "node:fs";
import path from "node:path";

const sourceDir =
  process.env.MAP_SOURCE_DIR || "/Users/an-yuchan/.tmp-statgarten-maps/json";
const outputFile =
  process.env.MAP_OUTPUT_FILE ||
  "/Users/an-yuchan/south-korea-map-quiz/data/regions.js";

const TOLERANCE = Number(process.env.MAP_SIMPLIFY_TOLERANCE || 90);
const VIEWBOX_WIDTH = 820;
const VIEWBOX_HEIGHT = 1120;
const PADDING = 26;

const provinceDisplayNames = {
  강원도: "강원특별자치도",
  경기도: "경기도",
  경상남도: "경상남도",
  경상북도: "경상북도",
  광주광역시: "광주광역시",
  대구광역시: "대구광역시",
  대전광역시: "대전광역시",
  부산광역시: "부산광역시",
  서울특별시: "서울특별시",
  세종특별자치시: "세종특별자치시",
  울산광역시: "울산광역시",
  인천광역시: "인천광역시",
  전라남도: "전라남도",
  전라북도: "전북특별자치도",
  제주특별자치도: "제주특별자치도",
  충청남도: "충청남도",
  충청북도: "충청북도",
};

function isOrdinaryDistrictName(name) {
  return name.includes("시 ") && name.endsWith("구");
}

function getParentCityName(name) {
  return name.split(" ")[0];
}

function squaredDistance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, squaredTolerance, simplified) {
  let maxSquaredDistance = squaredTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i += 1) {
    const distance = squaredSegmentDistance(points[i], points[first], points[last]);
    if (distance > maxSquaredDistance) {
      index = i;
      maxSquaredDistance = distance;
    }
  }

  if (index !== -1) {
    if (index - first > 1) {
      simplifyDPStep(points, first, index, squaredTolerance, simplified);
    }
    simplified.push(points[index]);
    if (last - index > 1) {
      simplifyDPStep(points, index, last, squaredTolerance, simplified);
    }
  }
}

function simplifyRing(points, tolerance) {
  if (points.length <= 4) {
    return points;
  }

  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const working = closed ? points.slice(0, -1) : points.slice();
  if (working.length <= 3) {
    return closed ? [...working, working[0]] : working;
  }

  const squaredTolerance = tolerance * tolerance;
  const simplified = [working[0]];
  simplifyDPStep(working, 0, working.length - 1, squaredTolerance, simplified);
  simplified.push(working.at(-1));

  const deduped = [];
  for (const point of simplified) {
    const prev = deduped.at(-1);
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      deduped.push(point);
    }
  }

  while (deduped.length < 3 && working.length > deduped.length) {
    deduped.push(working[deduped.length]);
  }

  return closed ? [...deduped, deduped[0]] : deduped;
}

function polygonArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function centroidFromBbox(bbox) {
  return [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
}

function updateBbox(bbox, x, y) {
  bbox.minX = Math.min(bbox.minX, x);
  bbox.minY = Math.min(bbox.minY, y);
  bbox.maxX = Math.max(bbox.maxX, x);
  bbox.maxY = Math.max(bbox.maxY, y);
}

function formatNumber(value) {
  return Number(value.toFixed(2));
}

function normalizeText(value) {
  return value.replace(/\s+/g, "").replace(/[().,/-]/g, "").toLowerCase();
}

const rawFeatures = [];
let minX = Number.POSITIVE_INFINITY;
let minY = Number.POSITIVE_INFINITY;
let maxX = Number.NEGATIVE_INFINITY;
let maxY = Number.NEGATIVE_INFINITY;

for (const fileName of fs.readdirSync(sourceDir)) {
  if (!fileName.endsWith(".json") || fileName.startsWith("전국_")) {
    continue;
  }

  const provinceSourceName = fileName.replace("_시군구_경계.json", "");
  const provinceName = provinceDisplayNames[provinceSourceName] || provinceSourceName;
  const filePath = path.join(sourceDir, fileName);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  for (const feature of parsed.features) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    rawFeatures.push({
      provinceName,
      provinceSourceName,
      code: feature.properties.id,
      name: feature.properties.title,
      polygons,
    });

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }
}

const mergedFeatureMap = new Map();

for (const feature of rawFeatures) {
  const ordinaryDistrict = isOrdinaryDistrictName(feature.name);
  const mergedName = ordinaryDistrict ? getParentCityName(feature.name) : feature.name;
  const mergedId = ordinaryDistrict
    ? `${feature.provinceSourceName}-${mergedName}`
    : feature.code;
  const mergedKey = `${feature.provinceSourceName}|${mergedName}`;
  const existing = mergedFeatureMap.get(mergedKey);

  if (!existing) {
    mergedFeatureMap.set(mergedKey, {
      id: mergedId,
      name: mergedName,
      provinceName: feature.provinceName,
      provinceSourceName: feature.provinceSourceName,
      polygons: [...feature.polygons],
    });
    continue;
  }

  existing.polygons.push(...feature.polygons);
}

const mergedFeatures = Array.from(mergedFeatureMap.values());

const scale = Math.min(
  (VIEWBOX_WIDTH - PADDING * 2) / (maxX - minX),
  (VIEWBOX_HEIGHT - PADDING * 2) / (maxY - minY),
);
const translateX = (VIEWBOX_WIDTH - (maxX - minX) * scale) / 2;
const translateY = (VIEWBOX_HEIGHT - (maxY - minY) * scale) / 2;

function projectPoint([x, y]) {
  return [translateX + (x - minX) * scale, translateY + (maxY - y) * scale];
}

const regions = mergedFeatures.map((feature) => {
  const projectedPolygons = [];
  const bbox = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let totalArea = 0;

  for (const polygon of feature.polygons) {
    const projectedPolygon = [];
    for (const ring of polygon) {
      const simplified = simplifyRing(ring, TOLERANCE).map(projectPoint);
      for (const [x, y] of simplified) {
        updateBbox(bbox, x, y);
      }
      totalArea += polygonArea(simplified);
      projectedPolygon.push(simplified);
    }
    projectedPolygons.push(projectedPolygon);
  }

  const pathData = projectedPolygons
    .map((polygon) =>
      polygon
        .map((ring) => {
          const [first, ...rest] = ring;
          return `M ${formatNumber(first[0])} ${formatNumber(first[1])} ${rest
            .map(([x, y]) => `L ${formatNumber(x)} ${formatNumber(y)}`)
            .join(" ")} Z`;
        })
        .join(" "),
    )
    .join(" ");

  return {
    id: feature.id,
    name: feature.name,
    province: feature.provinceName,
    provinceSource: feature.provinceSourceName,
    fullName: `${feature.provinceName} ${feature.name}`,
    path: pathData,
    bbox: {
      minX: formatNumber(bbox.minX),
      minY: formatNumber(bbox.minY),
      maxX: formatNumber(bbox.maxX),
      maxY: formatNumber(bbox.maxY),
    },
    center: centroidFromBbox(bbox).map(formatNumber),
    area: formatNumber(totalArea),
  };
});

const byProvince = new Map();
for (const region of regions) {
  const provinceRegions = byProvince.get(region.province) || [];
  provinceRegions.push(region);
  byProvince.set(region.province, provinceRegions);
}

for (const region of regions) {
  const sameProvince = (byProvince.get(region.province) || [])
    .filter((candidate) => candidate.id !== region.id)
    .sort((a, b) => squaredDistance(a.center, region.center) - squaredDistance(b.center, region.center))
    .slice(0, 8)
    .map((candidate) => candidate.id);
  region.sameProvinceNearby = sameProvince;
  region.acceptedAnswers = Array.from(
    new Set(
      [
        region.name,
        region.fullName,
        `${region.provinceSource} ${region.name}`,
        `${region.province} ${region.name}`,
      ].map(normalizeText),
    ),
  );
}

regions.sort((a, b) => {
  if (a.province === b.province) {
    return a.name.localeCompare(b.name, "ko");
  }
  return a.province.localeCompare(b.province, "ko");
});

const payload = {
  viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
  generatedAt: new Date().toISOString(),
  simplifyTolerance: TOLERANCE,
  regionCount: regions.length,
  provinces: Array.from(new Set(regions.map((region) => region.province))),
  regions,
};

const output = `export const MAP_DATA = ${JSON.stringify(payload, null, 2)};\n`;
fs.writeFileSync(outputFile, output, "utf8");

console.log(`Wrote ${regions.length} regions to ${outputFile}`);
