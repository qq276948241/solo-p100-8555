<template>
  <Layout>
    <h2 class="page-title">座位预约</h2>
    
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="success" class="alert alert-success">{{ success }}</div>
    <div class="alert alert-info">
      今日已预约 <strong>{{ todayStats.count }}</strong> / 2 个时段
      <span v-if="todayStats.slots.length">
        （已选：{{ todayStats.slots.map(slotLabels[s]).join('、') }}）
      </span>
    </div>
    
    <div class="card" style="margin-bottom: 20px;">
      <div class="filters">
        <div class="filter-item">
          <label>选择自习室</label>
          <select v-model="selectedRoom" @change="loadSeats">
            <option v-for="room in rooms" :key="room.id" :value="room.id">
              {{ room.name }}
            </option>
          </select>
        </div>
        
        <div class="filter-item">
          <label>选择时段</label>
          <div class="slot-buttons">
            <button
              v-for="(label, key) in slotLabels"
              :key="key"
              class="slot-btn"
              :class="{ active: selectedSlot === key, disabled: todayStats.slots.includes(key) }"
              @click="selectSlot(key)"
            >
              {{ label }}
              <span v-if="todayStats.slots.includes(key)" class="slot-tag">已选</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <div class="card">
      <div class="legend">
        <div class="legend-item">
          <span class="seat-legend available"></span>
          <span>可预约</span>
        </div>
        <div class="legend-item">
          <span class="seat-legend reserved"></span>
          <span>已被预约</span>
        </div>
        <div class="legend-item">
          <span class="seat-legend selected"></span>
          <span>已选择</span>
        </div>
        <div class="legend-item" style="margin-left: 20px;">
          <span class="zone-tag zone-silent">静音区</span>
        </div>
        <div class="legend-item">
          <span class="zone-tag zone-discussion">讨论区</span>
        </div>
      </div>
      
      <div v-if="seatGroups.silent.length" class="seat-section">
        <div class="zone-header">
          <span class="zone-tag zone-silent">🤫 静音区</span>
          <span class="zone-desc">请保持安静，适合专注学习</span>
        </div>
        <div class="seat-grid" :style="{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }">
          <div
            v-for="seat in seatGroups.silent"
            :key="seat.id"
            class="seat"
            :class="{
              reserved: seat.reserved,
              selected: selectedSeat?.id === seat.id,
              'zone-silent': true
            }"
            @click="selectSeat(seat)"
          >
            {{ seat.seat_number }}
          </div>
        </div>
      </div>
      
      <div v-if="seatGroups.discussion.length" class="seat-section">
        <div class="zone-header">
          <span class="zone-tag zone-discussion">💬 讨论区</span>
          <span class="zone-desc">可小声讨论，适合小组学习</span>
        </div>
        <div class="seat-grid" :style="{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }">
          <div
            v-for="seat in seatGroups.discussion"
            :key="seat.id"
            class="seat"
            :class="{
              reserved: seat.reserved,
              selected: selectedSeat?.id === seat.id,
              'zone-discussion': true
            }"
            @click="selectSeat(seat)"
          >
            {{ seat.seat_number }}
          </div>
        </div>
      </div>
      
      <div v-if="!seats.length" class="empty">
        暂无座位数据
      </div>
      
      <div v-if="selectedSeat" class="selected-info">
        <span>已选择：<strong>{{ selectedSeat.seat_number }}</strong>（{{ selectedSeat.zone === 'silent' ? '静音区' : '讨论区' }}）</span>
        <button class="btn btn-primary" @click="confirmReserve" :disabled="reserving || todayStats.count >= 2">
          {{ reserving ? '预约中...' : '确认预约' }}
        </button>
      </div>
    </div>
  </Layout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Layout from '../components/Layout.vue'
import http from '../http'

const slotLabels = {
  morning: '上午 (08:00-12:00)',
  afternoon: '下午 (13:00-17:00)',
  evening: '晚上 (18:00-22:00)'
}

const rooms = ref([])
const seats = ref([])
const selectedRoom = ref(null)
const selectedSlot = ref('morning')
const selectedSeat = ref(null)
const error = ref('')
const success = ref('')
const reserving = ref(false)
const todayStats = reactive({ count: 0, slots: [] })

const today = new Date().toISOString().split('T')[0]

const maxCols = computed(() => {
  if (!seats.value.length) return 6
  return Math.max(...seats.value.map(s => s.col_num), 6)
})

const seatGroups = computed(() => ({
  silent: seats.value.filter(s => s.zone === 'silent'),
  discussion: seats.value.filter(s => s.zone === 'discussion')
}))

function selectSlot(key) {
  if (todayStats.slots.includes(key)) return
  selectedSlot.value = key
  selectedSeat.value = null
  loadSeats()
}

function selectSeat(seat) {
  if (seat.reserved) return
  selectedSeat.value = selectedSeat.value?.id === seat.id ? null : seat
  error.value = ''
  success.value = ''
}

async function loadStats() {
  try {
    const stats = await http.get('/reservations/stats/today')
    todayStats.count = stats.count
    todayStats.slots = stats.slots
    if (todayStats.slots.includes(selectedSlot.value)) {
      const remaining = Object.keys(slotLabels).filter(k => !todayStats.slots.includes(k))
      if (remaining.length) selectedSlot.value = remaining[0]
    }
  } catch (e) {}
}

async function loadSeats() {
  if (!selectedRoom.value) return
  try {
    seats.value = await http.get(`/rooms/${selectedRoom.value}/seats`, {
      params: { date: today, timeSlot: selectedSlot.value }
    })
    selectedSeat.value = null
  } catch (e) {
    error.value = '加载座位失败'
  }
}

async function confirmReserve() {
  if (!selectedSeat.value) return
  error.value = ''
  success.value = ''
  reserving.value = true
  try {
    await http.post('/reservations', {
      seat_id: selectedSeat.value.id,
      date: today,
      time_slot: selectedSlot.value
    })
    success.value = '预约成功！'
    selectedSeat.value = null
    await loadStats()
    await loadSeats()
  } catch (e) {
    error.value = e.error || '预约失败'
  } finally {
    reserving.value = false
  }
}

onMounted(async () => {
  try {
    rooms.value = await http.get('/rooms')
    if (rooms.value.length) {
      selectedRoom.value = rooms.value[0].id
      await loadStats()
      await loadSeats()
    }
  } catch (e) {
    error.value = '加载数据失败'
  }
})
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-item label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.filter-item select {
  min-width: 180px;
}

.slot-buttons {
  display: flex;
  gap: 8px;
}

.slot-btn {
  padding: 10px 16px;
  border: 2px solid #e5e7eb;
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.slot-btn:hover:not(.disabled) {
  border-color: #c7d2fe;
}

.slot-btn.active {
  border-color: #667eea;
  background: #eef2ff;
  color: #4338ca;
  font-weight: 500;
}

.slot-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.slot-tag {
  background: #10b981;
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eee;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #6b7280;
}

.seat-legend {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.seat-legend.available {
  background: #dcfce7;
  border: 2px solid #86efac;
}

.seat-legend.reserved {
  background: #fee2e2;
  border: 2px solid #fca5a5;
}

.seat-legend.selected {
  background: #dbeafe;
  border: 2px solid #60a5fa;
}

.zone-tag {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}

.zone-silent {
  background: #ede9fe;
  color: #6d28d9;
}

.zone-discussion {
  background: #dcfce7;
  color: #15803d;
}

.seat-section {
  margin-bottom: 28px;
}

.zone-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.zone-desc {
  font-size: 13px;
  color: #9ca3af;
}

.seat-grid {
  display: grid;
  gap: 10px;
  max-width: 600px;
}

.seat {
  padding: 14px 8px;
  text-align: center;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  user-select: none;
}

.seat.zone-silent {
  background: #f5f3ff;
  border-color: #ddd6fe;
  color: #5b21b6;
}

.seat.zone-discussion {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}

.seat:hover:not(.reserved) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.seat.reserved {
  background: #fee2e2 !important;
  border-color: #fecaca !important;
  color: #991b1b !important;
  cursor: not-allowed;
  opacity: 0.7;
}

.seat.selected {
  background: #dbeafe !important;
  border-color: #3b82f6 !important;
  color: #1d4ed8 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.empty {
  text-align: center;
  padding: 40px;
  color: #9ca3af;
}

.selected-info {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
</style>
