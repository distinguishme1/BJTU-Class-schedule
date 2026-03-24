const WEEK_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const state = {
	data: null,
	selectedDay: getTodaySchoolDay(),
	currentWeek: 4,
	totalWeeks: 16,
};

init().catch((error) => {
	console.error(error);
	renderFatalError("课表加载失败，请检查 data.json 格式是否正确。");
});

async function init() {
	bindEvents();
	updateHeaderClock();
	setInterval(updateHeaderClock, 30_000);

	const data = await loadData();
	state.data = normalizeData(data);

	renderTabs();
	renderAll();
	registerSW();
}

function bindEvents() {
	const btnToday = document.getElementById("btnToday");
	btnToday?.addEventListener("click", () => {
		state.selectedDay = getTodaySchoolDay();
		renderAll();
	});

	const weekInput = document.getElementById("weekInput");
	const weekMinus = document.getElementById("weekMinus");
	const weekPlus = document.getElementById("weekPlus");

	weekInput?.addEventListener("change", () => {
		setCurrentWeek(Number(weekInput.value));
	});

	weekMinus?.addEventListener("click", () => {
		setCurrentWeek(state.currentWeek - 1);
	});

	weekPlus?.addEventListener("click", () => {
		setCurrentWeek(state.currentWeek + 1);
	});
}

async function loadData() {
	const response = await fetch("./data.json", { cache: "no-store" });
	if (!response.ok) {
		throw new Error(`failed to load data.json: ${response.status}`);
	}
	return response.json();
}

function normalizeData(raw) {
	const data = raw || {};
	const slots = Array.isArray(data.timeSlots) ? data.timeSlots : [];
	const courses = Array.isArray(data.courses) ? data.courses : [];
	const totalWeeks = clampNumber(data?.meta?.totalWeeks, 1, 30, 16);
	const currentWeek = clampNumber(data?.meta?.currentWeek, 1, totalWeeks, 4);
	state.totalWeeks = totalWeeks;
	state.currentWeek = currentWeek;
	return {
		meta: data.meta || {},
		updatedAt: data.updatedAt || "--",
		timeSlots: slots
			.map((s) => ({
				index: Number(s.index),
				start: String(s.start || ""),
				end: String(s.end || ""),
			}))
			.filter((s) => Number.isFinite(s.index) && s.start && s.end)
			.sort((a, b) => a.index - b.index),
		courses: courses
			.map((c) => ({
				name: String(c.name || "未命名课程"),
				teacher: String(c.teacher || "未知老师"),
				location: String(c.location || "未知地点"),
				day: Number(c.day),
				startSlot: Number(c.startSlot),
				endSlot: Number(c.endSlot),
				weeks: String(c.weeks || "全年"),
				note: String(c.note || ""),
			}))
			.filter((c) => c.day >= 1 && c.day <= 7 && Number.isFinite(c.startSlot) && Number.isFinite(c.endSlot))
			.sort((a, b) => a.day - b.day || a.startSlot - b.startSlot),
	};
}

function renderAll() {
	renderHero();
	renderTabs();
	renderWeekControl();
	renderNextClass();
	renderCourseList();
	renderUpdatedAt();
}

function renderWeekControl() {
	const weekInput = document.getElementById("weekInput");
	const weekHint = document.getElementById("weekHint");
	if (weekInput) {
		weekInput.min = "1";
		weekInput.max = String(state.totalWeeks || 16);
		weekInput.value = String(state.currentWeek || 1);
	}
	if (weekHint) {
		weekHint.textContent = `当前显示：第${state.currentWeek}周（共${state.totalWeeks}周）`;
	}
}

function renderHero() {
	const semesterTitle = document.getElementById("semesterTitle");
	const title = state.data?.meta?.semester ? `我的课表 · ${state.data.meta.semester}` : "我的课表";
	if (semesterTitle) semesterTitle.textContent = title;
}

function renderTabs() {
	const root = document.getElementById("weekdayTabs");
	if (!root) return;

	root.innerHTML = "";
	WEEK_NAMES.forEach((label, idx) => {
		const day = idx + 1;
		const tab = document.createElement("button");
		tab.type = "button";
		tab.className = "tab";
		tab.role = "tab";
		tab.setAttribute("aria-selected", String(day === state.selectedDay));
		tab.textContent = label;
		tab.addEventListener("click", () => {
			state.selectedDay = day;
			renderAll();
		});
		root.appendChild(tab);
	});
}

function renderNextClass() {
	const root = document.getElementById("nextClass");
	if (!root || !state.data) return;

	const now = new Date();
	const nowMinutes = now.getHours() * 60 + now.getMinutes();
	const today = getTodaySchoolDay();
	const list = state.data.courses.filter((c) => c.day === today && isCourseInWeek(c.weeks, state.currentWeek));

	const item = list.find((course) => {
		const start = getSlotStartMinutes(course.startSlot, state.data.timeSlots);
		const end = getSlotEndMinutes(course.endSlot, state.data.timeSlots);
		return start >= nowMinutes || (start <= nowMinutes && nowMinutes <= end);
	});

	if (!item) {
		root.className = "next-card next-card--empty";
		root.textContent = `第${state.currentWeek}周今天没有后续课程`;
		return;
	}

	const start = getSlotStartMinutes(item.startSlot, state.data.timeSlots);
	const end = getSlotEndMinutes(item.endSlot, state.data.timeSlots);
	const inProgress = start <= nowMinutes && nowMinutes <= end;
	const minutesLeft = inProgress ? end - nowMinutes : start - nowMinutes;
	const statusClass = inProgress ? "next-card__status next-card__status--now" : "next-card__status next-card__status--soon";
	const statusText = inProgress ? `正在上课，还剩约 ${Math.max(minutesLeft, 0)} 分钟` : `${Math.max(minutesLeft, 0)} 分钟后开始`;

	root.className = "next-card";
	root.innerHTML = `
		<div class="next-card__name">${escapeHtml(item.name)}</div>
		<div class="next-card__meta">${formatCourseTime(item, state.data.timeSlots)} · ${escapeHtml(item.location)}</div>
		<div class="next-card__meta">任课教师：${escapeHtml(item.teacher)} · ${escapeHtml(item.weeks)}</div>
		<div class="${statusClass}">${statusText}</div>
	`;
}

function renderCourseList() {
	const root = document.getElementById("courseList");
	const title = document.getElementById("listTitle");
	if (!root || !title || !state.data) return;

	title.textContent = `${WEEK_NAMES[state.selectedDay - 1]}课程 · 第${state.currentWeek}周`;
	const list = state.data.courses.filter((c) => c.day === state.selectedDay);
	const today = getTodaySchoolDay();
	const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
	const todayInWeek = list
		.filter((c) => c.day === today && isCourseInWeek(c.weeks, state.currentWeek))
		.sort((a, b) => a.startSlot - b.startSlot);

	const currentCourse = todayInWeek.find((course) => {
		const start = getSlotStartMinutes(course.startSlot, state.data.timeSlots);
		const end = getSlotEndMinutes(course.endSlot, state.data.timeSlots);
		return start <= nowMinutes && nowMinutes <= end;
	});

	const upcomingCourse = currentCourse
		? null
		: todayInWeek.find((course) => getSlotStartMinutes(course.startSlot, state.data.timeSlots) > nowMinutes) || null;

	if (!list.length) {
		root.innerHTML = '<div class="course-empty">这一天没有课程安排</div>';
		return;
	}

	root.innerHTML = list
		.map((course) => {
			const inWeek = isCourseInWeek(course.weeks, state.currentWeek);
			const isCurrent =
				inWeek &&
				state.selectedDay === today &&
				currentCourse &&
				currentCourse.name === course.name &&
				currentCourse.startSlot === course.startSlot &&
				currentCourse.endSlot === course.endSlot;
			const isUpcoming =
				inWeek &&
				state.selectedDay === today &&
				upcomingCourse &&
				upcomingCourse.name === course.name &&
				upcomingCourse.startSlot === course.startSlot &&
				upcomingCourse.endSlot === course.endSlot;
			const classes = ["course"];
			if (!inWeek) classes.push("course--dim");
			if (isCurrent) classes.push("course--now");
			if (isUpcoming) classes.push("course--soon");
			const badge = isCurrent
				? '<span class="course__badge course__badge--now">正在上课</span>'
				: isUpcoming
					? '<span class="course__badge course__badge--soon">快上课了</span>'
					: !inWeek
						? '<span class="course__badge course__badge--off">本周不上</span>'
						: "";
			return `
				<article class="${classes.join(" ")}">
					<div class="course__head">
						<h3 class="course__name">${escapeHtml(course.name)}</h3>
						<div class="course__time">${formatCourseTime(course, state.data.timeSlots)}</div>
					</div>
					${badge}
					<div class="course__meta">地点：${escapeHtml(course.location)}</div>
					<div class="course__meta">教师：${escapeHtml(course.teacher)} · 周次：${escapeHtml(course.weeks)}</div>
					${course.note ? `<div class="course__meta">备注：${escapeHtml(course.note)}</div>` : ""}
				</article>
			`;
		})
		.join("");
}

function renderUpdatedAt() {
	const root = document.getElementById("updatedAt");
	if (!root || !state.data) return;
	root.textContent = `数据更新时间：${state.data.updatedAt}`;
}

function updateHeaderClock() {
	const dateNow = document.getElementById("dateNow");
	if (!dateNow) return;
	const now = new Date();
	const day = WEEK_NAMES[getTodaySchoolDay() - 1];
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mi = String(now.getMinutes()).padStart(2, "0");
	dateNow.textContent = `${now.getFullYear()}-${mm}-${dd} ${day} ${hh}:${mi}`;
}

function getTodaySchoolDay() {
	const d = new Date().getDay();
	return d === 0 ? 7 : d;
}

function formatCourseTime(course, slots) {
	const start = slots.find((s) => s.index === course.startSlot);
	const end = slots.find((s) => s.index === course.endSlot);
	const left = start ? start.start : "--:--";
	const right = end ? end.end : "--:--";
	return `${left}-${right} 第${course.startSlot}-${course.endSlot}节`;
}

function parseHm(value) {
	const [h, m] = String(value).split(":").map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
	return h * 60 + m;
}

function getSlotStartMinutes(slotIndex, slots) {
	const slot = slots.find((s) => s.index === slotIndex);
	return slot ? parseHm(slot.start) : Number.MAX_SAFE_INTEGER;
}

function getSlotEndMinutes(slotIndex, slots) {
	const slot = slots.find((s) => s.index === slotIndex);
	return slot ? parseHm(slot.end) : Number.MAX_SAFE_INTEGER;
}

function setCurrentWeek(inputWeek) {
	state.currentWeek = clampNumber(inputWeek, 1, state.totalWeeks || 16, state.currentWeek || 4);
	renderAll();
}

function clampNumber(value, min, max, fallback) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	if (num < min) return min;
	if (num > max) return max;
	return Math.round(num);
}

function isCourseInWeek(weekText, currentWeek) {
	if (!weekText) return true;
	const text = String(weekText).replaceAll(" ", "");
	if (text.includes("全年") || text.includes("全学期")) return true;

	const isOddOnly = text.includes("单周");
	const isEvenOnly = text.includes("双周");
	if (isOddOnly && currentWeek % 2 === 0) return false;
	if (isEvenOnly && currentWeek % 2 !== 0) return false;

	const normalized = text
		.replaceAll("第", "")
		.replaceAll("周", "")
		.replaceAll("，", ",")
		.replaceAll("、", ",")
		.replaceAll("~", "-");
	const rangeMatches = normalized.match(/\d+(-\d+)?/g);
	if (!rangeMatches || rangeMatches.length === 0) {
		return true;
	}

	return rangeMatches.some((part) => {
		if (part.includes("-")) {
			const [start, end] = part.split("-").map(Number);
			if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
			return currentWeek >= start && currentWeek <= end;
		}
		const single = Number(part);
		return Number.isFinite(single) ? currentWeek === single : false;
	});
}

function escapeHtml(input) {
	return String(input)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function renderFatalError(message) {
	const root = document.getElementById("courseList");
	const next = document.getElementById("nextClass");
	if (next) {
		next.className = "next-card next-card--empty";
		next.textContent = message;
	}
	if (root) {
		root.innerHTML = `<div class="course-empty">${escapeHtml(message)}</div>`;
	}
}

function registerSW() {
	if (!("serviceWorker" in navigator)) return;
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("./sw.js").catch((error) => {
			console.warn("service worker register failed", error);
		});
	});
}
