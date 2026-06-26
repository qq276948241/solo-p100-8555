<template>
  <Layout>
    <h2 class="page-title">后台管理</h2>
    
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="success" class="alert alert-success">{{ success }}</div>
    
    <div class="card" style="margin-bottom: 20px;">
      <div class="section-header">
        <h3>自习室管理</h3>
        <button class="btn btn-primary" @click="showRoomModal = true">+ 新增自习室</button>
      </div>
      
      <div class="room-tabs">
        <div
          v-for="room in rooms"
          :key="room.id"
          class="room-tab"
          :class="{ active: selectedRoom === room.id }"
          @click="selectRoom(room.id)"
        >
          <span class="room-name">{{ room.name }}</span>
          <button class="room-delete" @click.stop="deleteRoom(room.id)" title="删除">×</button>
        </div>
      </div>
    </div>
    
    <div v-if="selectedRoom" class="card">
      <div class="section-header">
        <h3>座位管理 - {{ currentRoom?.name }}</h3>
        <button class="btn btn-primary" @click="showSeatModal = true">+ 新增座位</button>
      </div>
      
      <div class="legend" style="margin-bottom: 20px;">
        <div class="legend-item">
          <span class="status-dot active"></span>
          <span>启用中</span>
        </div>
        <div class="legend-item">
          <span class="status-dot inactive"></span>
          <span>已停用</span>
        </div>
      </div>
      
      <div v-if="seatGroups.silent.length" class="seat-section">
        <div class="zone-header">
          <span class="zone-tag zone-silent">🤫 静音区</span>
        </div>
        <div class="admin-seat-grid">
          <div
            v-for="seat in seatGroups.silent"
            :key="seat.id"
            class="admin-seat"
            :class="{ inactive: !seat.active }"
          >
            <div class="seat-label">{{ seat.seat_number }}</div>
            <div class="seat-actions">
              <button
                class="action-btn"
                :class="seat.active ? 'btn-warning' : 'btn-success'"
                @click="toggleSeat(seat)"
              >
                {{ seat.active ? '停用' : '启用' }}
              </button>
              <button class="action-btn btn-danger" @click="deleteSeat(seat.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="seatGroups.discussion.length" class="seat-section">
        <div class="zone-header">
          <span class="zone-tag zone-discussion">💬 讨论区</span>
        </div>
        <div class="admin-seat-grid">
          <div
            v-for="seat in seatGroups.discussion"
            :key="seat.id"
            class="admin-seat"
            :class="{ inactive: !seat.active }"
          >
            <div class="seat-label">{{ seat.seat_number }}</div>
            <div class="seat-actions">
              <button
                class="action-btn"
                :class="seat.active ? 'btn-warning' : 'btn-success'"
                @click="toggleSeat(seat)"
              >
                {{ seat.active ? '停用' : '启用' }}
              </button>
              <button class="action-btn btn-danger" @click="deleteSeat(seat.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="!seats.length" class="empty">暂无座位，请点击"新增座位"添加</div>
    </div>
    
    <div v-if="showRoomModal" class="modal-overlay" @click.self="showRoomModal = false">
      <div class="modal">
        <h3>新增自习室</h3>
        <div class="form-group">
          <label>自习室名称</label>
          <input v-model="newRoom.name" type="text" placeholder="例如：二号自习室" />
        </div>
        <div class="form-group">
          <label>描述（可选）</label>
          <input v-model="newRoom.description" type="text" placeholder="例如：图书馆三楼" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showRoomModal = false">取消</button>
          <button class="btn btn-primary" @click="addRoom" :disabled="!newRoom.name">确认</button>
        </div>
      </div>
    </div>
    
    <div v-if="showSeatModal" class="modal-overlay" @click.self="showSeatModal = false">
      <div class="modal">
        <h3>新增座位</h3>
        <div class="form-group">
          <label>座位编号</label>
          <input v-model="newSeat.seat_number" type="text" placeholder="例如：1排1号" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>区域</label>
            <select v-model="newSeat.zone">
              <option value="silent">静音区</option>
              <option value="discussion">讨论区</option>
            </select>
          </div>
          <div class="form-group">
            <label>排号</label>
            <input v-model.number="newSeat.row_num" type="number" min="1" />
          </div>
          <div class="form-group">
            <label>列号</label>
            <input v-model.number="newSeat.col_num" type="number" min="1" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showSeatModal = false">取消</button>
          <button class="btn btn-primary" @click="addSeat" :disabled="!newSeat.seat_number || !newSeat.row_num || !newSeat.col_num">确认</button>
        </div>
      </div>
    </div>
  </Layout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Layout from '../components/Layout.vue'
import http from '../http'

const rooms = ref([])
const seats = ref([])
const selectedRoom = ref(null)
const error = ref('')
const success = ref('')

const showRoomModal = ref(false)
const showSeatModal = ref(false)

const newRoom = reactive({ name: '', description: '' })
const newSeat = reactive({ seat_number: '', zone: 'silent', row_num: 1, col_num: 1 })

const currentRoom = computed(() => rooms.value.find(r => r.id === selectedRoom.value))

const seatGroups = computed(() => ({
  silent: seats.value.filter(s => s.zone === 'silent').sort((a, b) => a.row_num - b.row_num || a.col_num - b.col_num),
  discussion: seats.value.filter(s => s.zone === 'discussion').sort((a, b) => a.row_num - b.row_num || a.col_num - b.col_num)
}))

function clearMsg() {
  error.value = ''
  success.value = ''
}

async function loadRooms() {
  rooms.value = await http.get('/rooms')
  if (rooms.value.length && !selectedRoom.value) {
    selectedRoom.value = rooms.value[0].id
    await loadSeats()
  }
}

async function selectRoom(id) {
  selectedRoom.value = id
  await loadSeats()
}

async function loadSeats() {
  if (!selectedRoom.value) return
  seats.value = await http.get(`/admin/rooms/${selectedRoom.value}/seats`)
}

async function addRoom() {
  clearMsg()
  try {
    const room = await http.post('/rooms', { ...newRoom })
    rooms.value.push(room)
    newRoom.name = ''
    newRoom.description = ''
    showRoomModal.value = false
    success.value = '自习室创建成功'
  } catch (e) {
    error.value = e.error || '创建失败'
  }
}

async function deleteRoom(id) {
  if (!confirm('删除自习室会同时删除所有座位，确定继续？')) return
  clearMsg()
  try {
    await http.delete(`/rooms/${id}`)
    rooms.value = rooms.value.filter(r => r.id !== id)
    if (selectedRoom.value === id) {
      selectedRoom.value = rooms.value[0]?.id || null
      seats.value = []
    }
    success.value = '删除成功'
  } catch (e) {
    error.value = e.error || '删除失败'
  }
}

async function addSeat() {
  clearMsg()
  try {
    const seat = await http.post('/seats', { ...newSeat, room_id: selectedRoom.value })
    seats.value.push(seat)
    newSeat.seat_number = ''
    newSeat.row_num = 1
    newSeat.col_num = 1
    newSeat.zone = 'silent'
    showSeatModal.value = false
    success.value = '座位创建成功'
  } catch (e) {
    error.value = e.error || '创建失败'
  }
}

async function toggleSeat(seat) {
  clearMsg()
  try {
    const res = await http.put(`/seats/${seat.id}/toggle`)
    seat.active = res.active
    success.value = seat.active ? '已启用' : '已停用'
  } catch (e) {
    error.value = e.error || '操作失败'
  }
}

async function deleteSeat(id) {
  if (!confirm('确定删除该座位？')) return
  clearMsg()
  try {
    await http.delete(`/seats/${id}`)
    seats.value = seats.value.filter(s => s.id !== id)
    success.value = '删除成功'
  } catch (e) {
    error.value = e.error || '删除失败'
  }
}

onMounted(loadRooms)
</script>

<style scoped>
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h3 {
  font-size: 18px;
  color: #1f2937;
  font-weight: 600;
}

.room-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.room-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #f3f4f6;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.room-tab:hover {
  background: #e5e7eb;
}

.room-tab.active {
  background: #eef2ff;
  border-color: #667eea;
  color: #4338ca;
}

.room-name {
  font-weight: 500;
  font-size: 14px;
}

.room-delete {
  width: 22px;
  height: 22px;
  border: none;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.room-delete:hover {
  background: #fecaca;
}

.legend {
  display: flex;
  gap: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #6b7280;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.status-dot.active {
  background: #10b981;
}

.status-dot.inactive {
  background: #9ca3af;
}

.zone-header {
  margin-bottom: 14px;
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

.admin-seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.admin-seat {
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
  transition: all 0.2s;
}

.admin-seat:hover {
  border-color: #c7d2fe;
}

.admin-seat.inactive {
  opacity: 0.5;
  background: #f9fafb;
}

.seat-label {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 10px;
  color: #1f2937;
}

.seat-actions {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.action-btn {
  padding: 5px 10px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-warning {
  background: #fef3c7;
  color: #92400e;
}

.btn-warning:hover {
  background: #fde68a;
}

.btn-success {
  background: #d1fae5;
  color: #065f46;
}

.btn-success:hover {
  background: #a7f3d0;
}

.btn-danger {
  background: #fee2e2;
  color: #991b1b;
}

.btn-danger:hover {
  background: #fecaca;
}

.empty {
  text-align: center;
  padding: 40px;
  color: #9ca3af;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: #fff;
  border-radius: 12px;
  padding: 28px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal h3 {
  font-size: 18px;
  margin-bottom: 20px;
  color: #1f2937;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
</style>
