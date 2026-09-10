import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, Bell, BrainCircuit, Clock3, Gauge, History, MapPin, MessageCircle, Radio, Search, Send, Settings2, TrainFront, X, Zap } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// FastAPI is exposed locally alongside Vite during development.
const API = import.meta.env.VITE_API_URL || 'http://localhost:8001'
const PLATFORM_TICKET_PRICE = 20
type Data = any

const QUICK_STATIONS = [
  ['GNT', 'Guntur Jn'], ['BZA', 'Vijayawada Jn'], ['SC', 'Secunderabad Jn'], ['HYB', 'Hyderabad Deccan'],
  ['VSKP', 'Visakhapatnam'], ['NLR', 'Nellore'], ['TUNI', 'Tuni'], ['RJY', 'Rajahmundry'],
  ['EE', 'Eluru'], ['OGL', 'Ongole'], ['RU', 'Renigunta Jn'], ['MAS', 'Chennai Central'],
].map(([code, name]) => ({ code, name }))
const QUICK_TRAINS = [
  ['12603', 'Kakinada Town Express'], ['12727', 'Godavari SF Express'], ['12728', 'Visakhapatnam Godavari SF Express'],
  ['12739', 'Secunderabad - Visakhapatnam Garib Rath Express'], ['12740', 'Visakhapatnam - Secunderabad Garib Rath Express'],
  ['17016', 'Visakha Express'], ['17243', 'Guntur - Rayagada Express'], ['17244', 'Rayagada - Guntur Express'],
  ['17250', 'Secunderabad - Machilipatnam Express'], ['22204', 'Secunderabad - Visakhapatnam AC Duronto Express'],
].map(([trainId, trainName]) => ({ trainId, trainName }))

function useLive() {
  const [data, setData] = useState<Data | null>(null)
  const refresh = async () => { try { setData(await (await fetch(`${API}/api/dashboard`)).json()) } catch { /* retry below */ } }
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 5000); let ws: WebSocket | undefined; try { ws = new WebSocket(API.replace('http', 'ws') + '/ws'); ws.onmessage = refresh } catch { /* polling remains active */ } return () => { clearInterval(timer); ws?.close() } }, [])
  return { data, refresh }
}

function TrainIntro({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 5200)
    return () => window.clearTimeout(timer)
  }, [])

  return <section className="intro-screen" aria-label="RailETA AI opening animation">
    <div className="intro-backdrop" />
    <div className="intro-vignette" />
    <div className="intro-content">
      <div className="intro-brand"><TrainFront className="h-5 w-5" /> RailETA <span>AI</span></div>
      <p className="intro-kicker">LIVE COACHING TRAIN INTELLIGENCE</p>
      <h1>Know your train.<br /><em>Before you reach the platform.</em></h1>
      <p className="intro-copy">Preparing nationwide live train intelligence and ETA forecasts.</p>
      <div className="intro-progress"><i /></div>
      <p className="intro-demo">LIVE DATA ENABLED — RailRadar integration</p>
    </div>
    <button className="intro-skip" type="button" onClick={onComplete}>Skip intro</button>
  </section>
}

export default function App() {
  const live = useLive()
  const navigate = useNavigate()
  // Deep links such as /control should open immediately. The opening screen
  // is shown whenever the app is entered through the home route (/).
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return window.location.pathname === '/'
    } catch {
      return false
    }
  })
  const completeIntro = () => setShowIntro(false)
  useEffect(() => {
    const openBooking = (event: Event) => {
      const detail = (event as CustomEvent<Data>).detail || {}
      const query = new URLSearchParams({ trainId: detail.trainId || '', trainName: detail.trainName || '', boarding: detail.boarding || '', destination: detail.destination || '' })
      navigate(`/book?${query.toString()}`)
    }
    window.addEventListener('raileta-book-ticket', openBooking)
    return () => window.removeEventListener('raileta-book-ticket', openBooking)
  }, [navigate])
  if (showIntro) return <TrainIntro onComplete={completeIntro} />
  return <><Routes><Route path="/" element={<Navigate to="/passenger" replace />} /><Route path="/passenger" element={<Shell><PassengerSearch data={live.data} /></Shell>} /><Route path="/book" element={<Shell><BookingTicketPage /></Shell>} /><Route path="/control" element={<Navigate to="/passenger" replace />} /></Routes><RailEtaAssistant /></>
}

function RailEtaAssistant() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [nearbyPending, setNearbyPending] = useState(false)
  const [messages, setMessages] = useState<Data[]>([{ role: 'assistant', text: 'Ask me about a train location, ETA, delay, next station, or active network alerts.' }])
  const send = async (question = input) => {
    const rawMessage = question.trim()
    const message = nearbyPending && !/nearby|nearest|station/i.test(rawMessage) ? `nearby stations in ${rawMessage}` : rawMessage
    if (!message || busy) return
    setMessages((current) => [...current, { role: 'user', text: message }])
    setInput(''); setBusy(true)
    try {
      let coordinates: Data = {}
      if (/nearby station|nearest station|stations near|closest station/i.test(message) && !nearbyPending) {
        setNearbyPending(true)
        setMessages((current) => [...current, { role: 'assistant', text: 'Which city, area, or railway station are you near? I will find the closest stations there.' }])
        setBusy(false)
        return
      }
      const response = await fetch(`${API}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, ...coordinates }) })
      const payload = response.ok ? await response.json() : null
      setNearbyPending(false)
      setMessages((current) => [...current, { role: 'assistant', text: payload?.answer || "I don't have current data for that request.", sources: payload?.sources || [] }])
    } catch (error) {
      if (/nearby station|nearest station|stations near|closest station/i.test(message)) setNearbyPending(true)
      setMessages((current) => [...current, { role: 'assistant', text: 'I could not access your device location. What city, area, or railway station are you near?' }])
    }
    finally { setBusy(false) }
  }
  return <div className="raileta-assistant">{open && <section className="assistant-panel" aria-label="RailETA Assistant"><header><div><span><BrainCircuit className="h-4 w-4" /> RailETA Assistant</span><small>Live RailETA train intelligence</small></div><button type="button" onClick={() => setOpen(false)} aria-label="Close assistant"><X className="h-5 w-5" /></button></header><div className="assistant-messages">{messages.map((item, index) => <div key={index} className={`assistant-message ${item.role}`}><p>{item.text}</p></div>)}</div><div className="assistant-prompts"><button type="button" onClick={() => send('Where is train 17243 now?')}>Where is 17243?</button><button type="button" onClick={() => send('What are the active network alerts?')}>Network alerts</button></div><form onSubmit={(event) => { event.preventDefault(); send() }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask RailETA Assistant" /><button type="submit" disabled={busy || !input.trim()} aria-label="Send message"><Send className="h-4 w-4" /></button></form></section>}<button type="button" className="assistant-trigger" onClick={() => setOpen((value) => !value)} aria-label="Open RailETA Assistant"><MessageCircle className="h-5 w-5" /><span>Ask RailETA</span></button></div>
}
function Shell({ children }: { children: ReactNode }) { return <div className="min-h-screen text-slate-100"><header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8"><Link to="/passenger" className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-300 text-slate-950"><TrainFront /></div><div><div className="font-black">RailETA <span className="text-cyan-300">AI</span></div><div className="text-[10px] uppercase tracking-[.25em] text-slate-500">Network intelligence</div></div></Link><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><div className="text-xs font-bold text-emerald-300">● LIVE DATA CONNECTED</div><div className="text-[10px] text-slate-500">RailRadar updated 12 seconds ago</div></div><Bell className="h-5 w-5 text-slate-400" /></div></div></header><main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">{children}</main></div> }
function NavItem({ to, label }: { to: string; label: string }) { return <NavLink to={to} className={({ isActive }) => `rounded-xl px-4 py-2 text-sm font-semibold ${isActive ? 'bg-cyan-300 text-slate-950' : 'text-slate-400 hover:text-white'}`}>{label}</NavLink> }

function BookingTicketPage() {
  const navigate = useNavigate()
  const query = new URLSearchParams(window.location.search)
  const context = { trainId: query.get('trainId') || '', trainName: query.get('trainName') || '', boarding: query.get('boarding') || '', destination: query.get('destination') || '' }
  return <BookingAccount context={context} onClose={() => navigate('/passenger')} standalone />
}

function BookingAccount({ context, onClose, standalone = false }: { context: Data; onClose: () => void; standalone?: boolean }) {
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [bookingTrainId, setBookingTrainId] = useState(context.trainId || '')
  const [bookingTrainName, setBookingTrainName] = useState(context.trainName || '')
  const [bookingDeparture, setBookingDeparture] = useState('')
  const [bookingArrival, setBookingArrival] = useState('')
  const [bookingDuration, setBookingDuration] = useState('')
  const [boarding, setBoarding] = useState(context.boarding || '')
  const [destination, setDestination] = useState(context.destination || '')
  const [boardingOptions, setBoardingOptions] = useState<Data[]>([])
  const [destinationOptions, setDestinationOptions] = useState<Data[]>([])
  const [showBoardingOptions, setShowBoardingOptions] = useState(false)
  const [showDestinationOptions, setShowDestinationOptions] = useState(false)
  const [sessionToken, setSessionToken] = useState('')
  const [ticket, setTicket] = useState<Data | null>(null)
  const [routeServices, setRouteServices] = useState<Data[]>([])
  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'sign-in' | 'journey' | 'complete'>('email')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const formatJourneyDuration = (value: unknown) => {
    const minutes = Number(value)
    if (!Number.isFinite(minutes) || minutes <= 0) return typeof value === 'string' && value ? value : 'Duration unavailable'
    const hours = Math.floor(minutes / 60)
    const remainder = Math.round(minutes % 60)
    return hours ? `${hours} hr${hours === 1 ? '' : 's'}${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`
  }
  const stationSuggestions = (value: string, setOptions: (options: Data[]) => void) => {
    if (value.trim().length < 2) return setOptions([])
    const localMatches = QUICK_STATIONS.filter((station) => `${station.name} ${station.code}`.toLowerCase().includes(value.trim().toLowerCase()))
    setOptions(localMatches)
    fetch(`${API}/api/stations/search?query=${encodeURIComponent(value)}`).then((response) => response.ok ? response.json() : null).then((response) => { if (response?.stations?.length) setOptions(response.stations) }).catch(() => undefined)
  }
  useEffect(() => { const timer = window.setTimeout(() => stationSuggestions(boarding, setBoardingOptions), 180); return () => window.clearTimeout(timer) }, [boarding])
  useEffect(() => { const timer = window.setTimeout(() => stationSuggestions(destination, setDestinationOptions), 180); return () => window.clearTimeout(timer) }, [destination])
  useEffect(() => {
    if (step === 'journey' && bookingTrainId) setMessage((current) => current.includes('Platform ticket price') ? current : `${current} Platform ticket price: ₹${PLATFORM_TICKET_PRICE}.`)
  }, [step, bookingTrainId])
  const call = async (path: string, body: Data) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30000)
    setBusy(true)
    try {
      const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Unable to continue.')
      return payload
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('This request is taking too long. Please try again.')
      throw error
    } finally { window.clearTimeout(timeout); setBusy(false) }
  }
  const checkAccount = async () => { try { setMessage('Checking your RailETA account…'); const result = await call('/api/auth/account-status', { email }); if (result.exists) { setMessage('Account found. Enter your password to continue.'); setStep('sign-in') } else { setMessage('New passenger account. Sending your verification code…'); await sendOtp() } } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to continue.') } }
  const sendOtp = async () => { try { setMessage('Sending verification code to your email…'); const result = await call('/api/auth/request-otp', { email }); setMessage(result.message); setStep('otp') } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to send the code.') } }
  const confirmOtp = async () => { try { const result = await call('/api/auth/verify-otp', { email, otp }); setMessage(result.message); setStep('password') } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to verify the code.') } }
  const createAccount = async () => { try { const result = await call('/api/auth/create-password', { email, password }); setMessage(result.message); setStep('sign-in') } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create the account.') } }
  const signIn = async () => { try { const result = await call('/api/auth/sign-in', { email, password }); setSessionToken(result.sessionToken); setMessage('Signed in. Confirm your general-ticket journey.'); setStep('journey') } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to sign in.') } }
  const findRouteServices = async () => {
    if (!boarding.trim() || !destination.trim()) return
    setBusy(true); setMessage('Finding services for your journey…')
    try {
      const response = await fetch(`${API}/api/passenger/search?origin=${encodeURIComponent(boarding)}&destination=${encodeURIComponent(destination)}&live=true`)
      const payload = response.ok ? await response.json() : null
      const services = payload?.trains || []
      setRouteServices(services)
      setMessage(services.length ? `Choose one of ${services.length} available service${services.length === 1 ? '' : 's'}.` : (payload?.error || 'No services are available for this journey today.'))
    } catch { setMessage('Unable to find route services. Please try again.') }
    finally { setBusy(false) }
  }
  const bookTicket = async () => { try { const result = await call('/api/bookings/general-ticket', { session_token: sessionToken, train_id: bookingTrainId, train_name: bookingTrainName, boarding_station: boarding, destination_station: destination, scheduled_departure: bookingDeparture, scheduled_arrival: bookingArrival, journey_duration: bookingDuration }); setTicket({ ...result.ticket, platformTicketPrice: PLATFORM_TICKET_PRICE }); setMessage(`${result.message} Platform ticket price: ₹${PLATFORM_TICKET_PRICE}.`); setStep('complete') } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to book the ticket.') } }
  const title = step === 'journey' ? 'Review your journey' : step === 'complete' ? 'Reservation confirmed' : step === 'sign-in' ? 'Welcome back' : 'Passenger ticket booking'
  const activeStep = step === 'journey' || step === 'complete' ? 3 : step === 'otp' || step === 'password' || step === 'sign-in' ? 2 : 1
  if ((() => step === 'journey')()) return <div className={standalone ? 'booking-page' : 'booking-modal'} role="dialog" aria-modal={!standalone} aria-label="RailETA ticket booking"><section><button type="button" className="booking-close" onClick={onClose} aria-label="Close booking">×</button><p className="eyebrow text-cyan-300">RAILETA · PASSENGER SERVICES</p><h2>Review your journey</h2><div className="booking-steps">{['Account', 'Verify', 'Journey'].map((label, index) => <div key={label} className="active"><i>{index + 1}</i><span>{label}</span></div>)}</div><div className="booking-train-summary"><span>Selected service</span><b>{bookingTrainId ? `${bookingTrainId} · ${bookingTrainName}` : 'Find a service using your journey stations'}</b></div><p className="booking-copy">Enter your boarding and destination stations. Choose a matching service before confirming.</p><label className="booking-station-field">From<input value={boarding} onFocus={() => setShowBoardingOptions(true)} onBlur={() => window.setTimeout(() => setShowBoardingOptions(false), 140)} onChange={(event) => { setBoarding(event.target.value); setShowBoardingOptions(true); setRouteServices([]); setBookingTrainId('') }} placeholder="Type departure station" />{showBoardingOptions && boardingOptions.length > 0 && <div className="booking-station-options">{boardingOptions.map((station) => <button key={station.code || station.name} type="button" onMouseDown={() => { setBoarding(station.name); setShowBoardingOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label><label className="booking-station-field mt-3">To<input value={destination} onFocus={() => setShowDestinationOptions(true)} onBlur={() => window.setTimeout(() => setShowDestinationOptions(false), 140)} onChange={(event) => { setDestination(event.target.value); setShowDestinationOptions(true); setRouteServices([]); setBookingTrainId('') }} placeholder="Type arrival station" />{showDestinationOptions && destinationOptions.length > 0 && <div className="booking-station-options">{destinationOptions.map((station) => <button key={station.code || station.name} type="button" onMouseDown={() => { setDestination(station.name); setShowDestinationOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label>{routeServices.length > 0 && <div className="booking-route-services">{routeServices.map((service) => <button type="button" key={service.trainId} className={bookingTrainId === service.trainId ? 'active' : ''} onClick={() => { setBookingTrainId(service.trainId); setBookingTrainName(service.trainName); setBookingDeparture(service.departure || 'Scheduled time unavailable'); setBookingArrival(service.arrival || 'Scheduled time unavailable'); setBookingDuration(formatJourneyDuration(service.durationMinutes)); setMessage(`${service.trainId} selected. You can confirm your general ticket.`) }}><b>{service.trainId} · {service.trainName}</b><span>{service.departure || 'Scheduled departure'} → {service.arrival || 'Scheduled arrival'}</span></button>)}</div>}<p className="booking-copy">General class · Prototype reservation · No payment is collected.</p>{bookingTrainId ? <button type="button" className="booking-primary" disabled={busy || !boarding.trim() || !destination.trim()} onClick={bookTicket}>{busy ? 'Confirming…' : 'Confirm general ticket'}</button> : <button type="button" className="booking-primary" disabled={busy || !boarding.trim() || !destination.trim()} onClick={findRouteServices}>{busy ? 'Finding services…' : 'Find matching services'}</button>}{message && <p className="booking-message">{message}</p>}</section></div>
  if ((() => step === 'complete')() && ticket) return <div className={standalone ? 'booking-page' : 'booking-modal'} role="dialog" aria-modal={!standalone} aria-label="RailETA ticket confirmation"><section><button type="button" className="booking-close" onClick={onClose} aria-label="Close booking">×</button><p className="eyebrow text-cyan-300">RAILETA · PASSENGER SERVICES</p><h2>Reservation confirmed</h2><div className="booking-steps">{['Account', 'Verify', 'Journey'].map((label, index) => <div key={label} className="active"><i>{index + 1}</i><span>{label}</span></div>)}</div><div className="booking-ticket"><div className="booking-ticket-top"><span>RAILETA PASSENGER TICKET</span><b>{ticket.ticketId || ticket.reference}</b></div><div className="booking-ticket-route"><strong>{ticket.boardingStation}</strong><i>→</i><strong>{ticket.destinationStation}</strong></div><dl><div><dt>Train</dt><dd>{ticket.trainId} · {ticket.trainName}</dd></div><div><dt>Class</dt><dd>{ticket.travelClass}</dd></div><div><dt>Departure</dt><dd>{ticket.scheduledDeparture || 'Unavailable'}</dd></div><div><dt>Arrival</dt><dd>{ticket.scheduledArrival || 'Unavailable'}</dd></div><div><dt>Journey time</dt><dd>{ticket.journeyDuration || 'Unavailable'}</dd></div><div><dt>Issued</dt><dd>{ticket.issuedAt ? new Date(ticket.issuedAt).toLocaleString() : 'Just now'}</dd></div><div><dt>Status</dt><dd>{ticket.status}</dd></div></dl><p>Receipt sent to your registered email · Prototype reservation, not valid for travel.</p></div><p className="booking-message">{message}</p></section></div>
  return <div className={standalone ? 'booking-page' : 'booking-modal'} role="dialog" aria-modal={!standalone} aria-label="RailETA ticket booking"><section><button type="button" className="booking-close" onClick={onClose} aria-label="Close booking">×</button><p className="eyebrow text-cyan-300">RAILETA · PASSENGER SERVICES</p><h2>{title}</h2><div className="booking-steps">{['Account', 'Verify', 'Journey'].map((label, index) => <div key={label} className={activeStep >= index + 1 ? 'active' : ''}><i>{index + 1}</i><span>{label}</span></div>)}</div><div className="booking-train-summary"><span>Selected service</span><b>{bookingTrainId ? `${bookingTrainId} · ${bookingTrainName || 'Train name to be added'}` : 'Choose a train from passenger search before confirming'}</b></div>{step === 'email' && <><p className="booking-copy">Use your email to sign in or create a RailETA passenger account.</p><label>Email address<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@gmail.com" /></label><button type="button" className="booking-primary" disabled={busy || !email.trim()} onClick={checkAccount}>{busy ? (message.includes('verification') ? 'Sending code…' : 'Checking account…') : 'Continue securely'}</button></>}{step === 'otp' && <><p className="booking-copy">Enter the six-digit verification code sent to {email}.</p><label>Verification code<input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit OTP" /></label><button type="button" className="booking-primary" disabled={busy || otp.length !== 6} onClick={confirmOtp}>{busy ? 'Verifying…' : 'Verify email'}</button><button type="button" className="booking-secondary" disabled={busy} onClick={sendOtp}>Resend code</button></>}{step === 'password' && <><p className="booking-copy">Create a password with at least 8 characters to secure your RailETA account.</p><label>Create password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="At least 8 characters" /></label><button type="button" className="booking-primary" disabled={busy || password.length < 8} onClick={createAccount}>{busy ? 'Creating…' : 'Create account'}</button></>}{step === 'sign-in' && <><p className="booking-copy">Enter your password to continue with the selected ticket.</p><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Your RailETA password" /></label><button type="button" className="booking-primary" disabled={busy || password.length < 8} onClick={signIn}>{busy ? 'Signing in…' : 'Continue to journey'}</button></>}{step === 'journey' && <><p className="booking-copy">Enter where you are boarding and where you want to go. Select a suggested station for each field.</p><label className="booking-station-field">From<input value={boarding} onFocus={() => setShowBoardingOptions(true)} onBlur={() => window.setTimeout(() => setShowBoardingOptions(false), 140)} onChange={(event) => { setBoarding(event.target.value); setShowBoardingOptions(true) }} placeholder="Type departure station" />{showBoardingOptions && boardingOptions.length > 0 && <div className="booking-station-options">{boardingOptions.map((station) => <button key={station.code || station.name} type="button" onMouseDown={() => { setBoarding(station.name); setShowBoardingOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label><label className="booking-station-field mt-3">To<input value={destination} onFocus={() => setShowDestinationOptions(true)} onBlur={() => window.setTimeout(() => setShowDestinationOptions(false), 140)} onChange={(event) => { setDestination(event.target.value); setShowDestinationOptions(true) }} placeholder="Type arrival station" />{showDestinationOptions && destinationOptions.length > 0 && <div className="booking-station-options">{destinationOptions.map((station) => <button key={station.code || station.name} type="button" onMouseDown={() => { setDestination(station.name); setShowDestinationOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label><p className="booking-copy">General class · Prototype reservation · No payment is collected.</p><button type="button" className="booking-primary" disabled={busy || !bookingTrainId.trim() || !bookingTrainName.trim() || !boarding.trim() || !destination.trim()} onClick={bookTicket}>{busy ? 'Confirming…' : 'Confirm general ticket'}</button></>}{step === 'complete' && ticket && <div className="booking-ticket"><div className="booking-ticket-top"><span>RAILETA PASSENGER TICKET</span><b>{ticket.ticketId || ticket.reference}</b></div><div className="booking-ticket-route"><strong>{ticket.boardingStation}</strong><i>→</i><strong>{ticket.destinationStation}</strong></div><dl><div><dt>Train</dt><dd>{ticket.trainId} · {ticket.trainName}</dd></div><div><dt>Class</dt><dd>{ticket.travelClass}</dd></div><div><dt>Issued</dt><dd>{ticket.issuedAt ? new Date(ticket.issuedAt).toLocaleString() : 'Just now'}</dd></div><div><dt>Status</dt><dd>{ticket.status}</dd></div></dl><p>Receipt sent to your registered email · Prototype reservation, not valid for travel.</p></div>}{message && <p className="booking-message">{message}</p>}</section></div>
}

function PassengerSearch({ data }: { data: Data }) {
  const [trainQuery, setTrainQuery] = useState(() => new URLSearchParams(window.location.search).get('train') || '')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [originOptions, setOriginOptions] = useState<Data[]>([])
  const [destinationOptions, setDestinationOptions] = useState<Data[]>([])
  const [trainOptions, setTrainOptions] = useState<Data[]>([])
  const [showOriginOptions, setShowOriginOptions] = useState(false)
  const [showDestinationOptions, setShowDestinationOptions] = useState(false)
  const [results, setResults] = useState<Data[]>([])
  const [message, setMessage] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [liveSelected, setLiveSelected] = useState<Data | null>(null)
  const [selectedTrain, setSelectedTrain] = useState<Data | null>(null)
  const [history, setHistory] = useState<Data[]>(() => { try { return JSON.parse(localStorage.getItem('raileta-search-history') || '[]') } catch { return [] } })
  const stationSuggestions = (value: string, setOptions: (options: Data[]) => void) => {
    if (value.trim().length < 2) return setOptions([])
    const localMatches = QUICK_STATIONS.filter((station) => `${station.name} ${station.code}`.toLowerCase().includes(value.trim().toLowerCase()))
    setOptions(localMatches)
    fetch(`${API}/api/stations/search?query=${encodeURIComponent(value)}`).then((response) => response.ok ? response.json() : null).then((response) => { if (response?.stations?.length) setOptions(response.stations) }).catch(() => undefined)
  }
  useEffect(() => { const timer = window.setTimeout(() => stationSuggestions(origin, setOriginOptions), 250); return () => window.clearTimeout(timer) }, [origin])
  useEffect(() => { const timer = window.setTimeout(() => stationSuggestions(destination, setDestinationOptions), 250); return () => window.clearTimeout(timer) }, [destination])
  useEffect(() => {
    setSelectedId('')
    setLiveSelected(null)
    setSelectedTrain(null)
  }, [trainQuery, origin, destination])
  useEffect(() => {
    const fields = document.querySelectorAll<HTMLInputElement>('.passenger-find input')
    if (fields[0]) fields[0].placeholder = 'Search by train number/name'
    if (fields[1]) fields[1].placeholder = 'Boarding station'
    if (fields[2]) fields[2].placeholder = 'Destination station'
    const controls = document.querySelector('.passenger-find .find-submit')?.parentElement
    const selectedTrain = results.find((train) => train.trainId === selectedId) || results[0]
    const existing = controls?.querySelector<HTMLButtonElement>('.find-book')
    if (controls && !existing) {
      const booking = document.createElement('button')
      booking.className = 'find-book'
      booking.type = 'button'
      booking.textContent = 'Book ticket'
      controls.prepend(booking)
    }
    const booking = controls?.querySelector<HTMLButtonElement>('.find-book')
    if (booking) {
      booking.disabled = false
      booking.title = selectedTrain ? 'Book the selected train' : 'Open ticket booking'
      booking.onclick = () => window.dispatchEvent(new CustomEvent('raileta-book-ticket', { detail: { trainId: selectedTrain?.trainId, trainName: selectedTrain?.trainName, boarding: origin, destination } }))
    }
  }, [results, selectedId, origin, destination])
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('.passenger-find .find-simple input')
    const label = input?.closest('label')
    if (!label) return
    label.querySelector('.train-options')?.remove()
    if (trainQuery.trim().length < 2 || !trainOptions.length) return
    const dropdown = document.createElement('div')
    dropdown.className = 'station-options train-options'
    trainOptions.forEach((train) => {
      const option = document.createElement('button')
      const number = document.createElement('b')
      const name = document.createElement('span')
      option.type = 'button'
      number.textContent = train.trainId
      name.textContent = train.trainName
      option.append(number, name)
      option.onmousedown = (event) => {
        event.preventDefault()
        setTrainQuery(train.trainId)
        setResults([train])
        openTrain(train)
        setTrainOptions([])
        setMessage(`${train.trainId} · ${train.trainName}`)
      }
      dropdown.append(option)
    })
    label.append(dropdown)
    return () => dropdown.remove()
  }, [trainOptions, trainQuery])
  useEffect(() => {
    const query = trainQuery.trim()
    if (!query && !origin.trim() && !destination.trim()) {
      setResults([])
      setSelectedId('')
      setMessage('')
      return
    }
    if (!query || origin.trim() || destination.trim()) { setTrainOptions([]); return }
    const localMatches = QUICK_TRAINS.filter((train) => `${train.trainId} ${train.trainName}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    setTrainOptions(localMatches)
    setMessage(`Finding trains matching "${query}"…`)
    const timer = window.setTimeout(() => {
      fetch(`${API}/api/catalog/trains?query=${encodeURIComponent(query)}&page=1&page_size=12`)
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (!payload) return
          const matches = payload.trains || []
          setResults(matches.length ? matches : localMatches)
          setTrainOptions(matches.slice(0, 6).length ? matches.slice(0, 6) : localMatches)
          setMessage(payload.trains?.length ? `Matching trains for "${query}"` : (payload.error || `No trains match "${query}".`))
        })
        .catch(() => setResults(localMatches))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [trainQuery, origin, destination])
  const saveHistory = (entry: Data) => setHistory((current) => {
    const next = [entry, ...current.filter((item) => item.label !== entry.label)].slice(0, 8)
    try { localStorage.setItem('raileta-search-history', JSON.stringify(next)) } catch { /* keep the in-memory history if storage is unavailable */ }
    return next
  })
  const search = async () => {
    const useRoute = Boolean(origin.trim() || destination.trim())
    if (useRoute && (!origin.trim() || !destination.trim())) { setResults([]); setMessage('Enter both departure and arrival places to search a route.'); return }
    if (!useRoute && !trainQuery.trim()) { setResults([]); setMessage('Enter a train number/name, or choose both departure and arrival places.'); return }
    setMessage(useRoute ? 'Finding available services…' : 'Searching train directory…')
    const endpoint = useRoute ? `${API}/api/passenger/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&live=false` : `${API}/api/catalog/trains?query=${encodeURIComponent(trainQuery)}&page=1&page_size=50`
    try {
      const response = await fetch(endpoint)
      const payload = response.ok ? await response.json() : null
      const trains = payload?.trains || []
      setResults(trains)
      setSelectedId('')
      if (useRoute && payload?.verificationPending) {
        setMessage(trains.length ? `${trains.length} timetable matches found. Checking today's live departures…` : (payload?.error || 'No trains found for this route.'))
        const verifiedResponse = await fetch(endpoint.replace('live=false', 'live=true'))
        const verifiedPayload = verifiedResponse.ok ? await verifiedResponse.json() : null
        if (!verifiedPayload) return
        const verifiedTrains = verifiedPayload.trains || []
        setResults(verifiedTrains)
        const verifiedNote = verifiedPayload.departedExcluded ? ` ${verifiedPayload.departedExcluded} already departed service${verifiedPayload.departedExcluded === 1 ? ' was' : 's were'} hidden.` : ''
        setMessage(verifiedTrains.length ? `${verifiedTrains.length} train${verifiedTrains.length === 1 ? '' : 's'} available for this journey today.${verifiedNote}` : (verifiedPayload.error || 'No trains available for this journey today.'))
        saveHistory({ label: `${origin} → ${destination}`, type: 'Route', at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), count: verifiedTrains.length })
        return
      }
      const departedNote = useRoute && payload?.departedExcluded ? ` ${payload.departedExcluded} already departed service${payload.departedExcluded === 1 ? ' was' : 's were'} hidden.` : ''
      setMessage(trains.length ? `${trains.length} train${trains.length === 1 ? '' : 's'} available for this journey today.${departedNote}` : (payload?.error || 'No trains available for this journey today.'))
      saveHistory({ label: useRoute ? `${origin} → ${destination}` : trainQuery, type: useRoute ? 'Route' : 'Train', at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), count: trains.length })
    } catch { setResults([]); setMessage('Search is temporarily unavailable. Please try again.') }
  }
  const openTrain = (train: Data) => {
    // Render immediately on click. The request below replaces this lightweight
    // preview with the route, live position, and ML ETA when it returns.
    const routeMatch = String(train.trainName || '').match(/^\s*(.+?)\s+-\s+(.+?)(?:\s+Express|\s+SF|\s+Special)?\s*$/i)
    const identity = { ...train, originStation: train.originStation || routeMatch?.[1] || 'Origin', destinationStation: train.destinationStation || routeMatch?.[2] || 'Destination' }
    // A train can be opened directly from the result card or autocomplete,
    // without pressing Search. Record that interaction as a recent search too.
    saveHistory({ label: String(train.trainId), type: 'Train', at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), count: 1 })
    setSelectedId(String(train.trainId))
    setSelectedTrain(identity)
    setLiveSelected({
      trainId: train.trainId,
      trainName: train.trainName || `Train ${train.trainId}`,
      originStation: identity.originStation,
      destinationStation: identity.destinationStation,
      currentStation: 'Loading live position…',
      nextStation: 'Loading…',
      operationalStatus: 'Loading live train data…',
      predictedEtaMinutes: null,
      delayMin: 0,
      speedKmph: 0,
      confidence: 0,
      routeTimeline: [],
      dataSource: 'loading',
    })
    setMessage(`Loading ${train.trainId} live status…`)
  }
  const baseSelected = selectedTrain || results.find((train) => String(train.trainId) === String(selectedId))
  useEffect(() => {
    if (!selectedId) return
    window.requestAnimationFrame(() => document.getElementById('live-details')?.scrollIntoView({ behavior: 'auto', block: 'start' }))
  }, [selectedId])
  useEffect(() => {
    if (!baseSelected?.trainId) return
    let active = true
    let controller: AbortController | null = null
    const load = async () => {
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      const timeout = window.setTimeout(() => requestController.abort(), 10000)
      try {
        const response = await fetch(`${API}/api/trains/${baseSelected.trainId}?live=true`, { signal: requestController.signal })
        const prediction = response.ok ? await response.json() : null
        if (active && prediction) setLiveSelected({ ...prediction, trainId: baseSelected.trainId, trainName: baseSelected.trainName || prediction.trainName, originStation: baseSelected.originStation || prediction.originStation, destinationStation: baseSelected.destinationStation || prediction.destinationStation })
      } catch {
        // Never display the generic simulator route for a selected train. It
        // can contain a station from another service (for example Ongole).
        if (active) setLiveSelected((current: Data | null) => current ? {
          ...current,
          currentStation: 'Verified live position pending',
          nextStation: 'Verified route pending',
          section: 'Waiting for the selected train live route',
          operationalStatus: 'Live feed reconnecting…',
          speedKmph: null,
          delayMin: null,
          confidence: 0,
          predictedEtaMinutes: null,
          predictedArrivalAtNextStation: null,
          destinationEta: null,
          destinationEtaRange: [],
          routeTimeline: [],
          dataSource: 'warming',
          liveDataError: 'RailRadar has not returned a verified route yet.'
        } : current)
        setMessage(`Waiting for verified RailRadar data for ${baseSelected.trainId}…`)
      } finally {
        window.clearTimeout(timeout)
      }
    }
    load()
    // The first response is cache-first, so the page opens immediately. Poll
    // briefly to replace it once the remote live provider has finished.
    // RailRadar can take a few seconds to answer. Polling faster than that
    // aborts every in-flight request and leaves the UI stuck on "waiting".
    const timer = window.setInterval(load, 12000)
    return () => { active = false; controller?.abort(); window.clearInterval(timer) }
  }, [baseSelected?.trainId])
  // Do not scroll the page on each live refresh.  Passengers may be reading a
  // later stop; the timeline's "Live position" button handles explicit jumps.
  const clear = () => { setTrainQuery(''); setOrigin(''); setDestination(''); setResults([]); setSelectedId(''); setSelectedTrain(null); setLiveSelected(null); setMessage('') }
  return <div className="passenger-find space-y-6"><section className="find-hero"><div className="find-rail-brand"><TrainFront className="h-6 w-6" /> RailETA AI <span>Passenger</span></div><h1>Find your train</h1><p>Search by train number/name, or search trains between two stations.</p><div className="find-simple"><label><Search className="h-5 w-5" /> Find by train number or train name<input autoFocus value={trainQuery} onChange={(event) => { setTrainQuery(event.target.value); setOrigin(''); setDestination('') }} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Example: 12603 or Charminar Express" /></label></div><div className="find-or"><span>OR</span></div><div className="find-route"><label>From<input value={origin} onFocus={() => setShowOriginOptions(true)} onBlur={() => window.setTimeout(() => setShowOriginOptions(false), 160)} onChange={(event) => { setOrigin(event.target.value); setTrainQuery(''); setShowOriginOptions(true) }} placeholder="Guntur or GNT" />{showOriginOptions && originOptions.length > 0 && <div className="station-options">{originOptions.map((station) => <button type="button" key={station.code} onMouseDown={() => { setOrigin(station.name); setShowOriginOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label><span>→</span><label>To<input value={destination} onFocus={() => setShowDestinationOptions(true)} onBlur={() => window.setTimeout(() => setShowDestinationOptions(false), 160)} onChange={(event) => { setDestination(event.target.value); setTrainQuery(''); setShowDestinationOptions(true) }} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Vijayawada or BZA" />{showDestinationOptions && destinationOptions.length > 0 && <div className="station-options">{destinationOptions.map((station) => <button type="button" key={station.code} onMouseDown={() => { setDestination(station.name); setShowDestinationOptions(false) }}><b>{station.name}</b><span>{station.code}{station.city ? ` · ${station.city}` : ''}</span></button>)}</div>}</label></div><div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm text-blue-100/75">{message}</p><div className="flex gap-2"><button type="button" onClick={clear} className="find-clear">Clear</button><button type="button" onClick={search} className="find-submit">Search</button></div></div></section>{results.length > 0 && <section className="find-results"><div className="flex items-center justify-between"><div><p className="eyebrow text-blue-700">SEARCH RESULTS</p><h2>Choose a train</h2></div><span>{results.length} found</span></div><div className="mt-4 divide-y divide-slate-200">{results.map((train) => <button key={train.trainId} onClick={() => openTrain(train)} className={`find-result ${selectedId === train.trainId ? 'selected' : ''}`}><div className="find-result-number">{train.trainId}</div><div className="min-w-0 flex-1"><b>{train.trainName}</b><p>{train.originStation ? `${train.originStation} → ${train.destinationStation}` : 'Tap for full route and live status'}</p></div><div className="find-result-time">{train.departure ? <><b>{train.departure}</b><span>Departure</span></> : <Radio className="h-5 w-5" />}</div></button>)}</div></section>}{liveSelected && <Passenger data={{ ...data, train: liveSelected }} />}<section className="find-history"><div className="flex items-center justify-between"><div><p className="eyebrow text-blue-700"><History className="h-4 w-4" /> RECENT SEARCHES</p><h2>Search history</h2></div>{history.length > 0 && <button type="button" onClick={() => { localStorage.removeItem('raileta-search-history'); setHistory([]) }}>Clear history</button>}</div>{history.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{history.map((item) => <button key={`${item.type}-${item.label}`} onClick={() => { if (item.type === 'Route') { const [from, to] = item.label.split(' → '); setTrainQuery(''); setOrigin(from || ''); setDestination(to || '') } else { setOrigin(''); setDestination(''); setTrainQuery(item.label) } }} className="find-history-item"><span>{item.type}</span><b>{item.label}</b><small>{item.count} results · {item.at}</small></button>)}</div> : <p className="mt-4 text-sm text-slate-500">Train and route searches will appear here.</p>}</section></div>
}

function PassengerFleet({ data }: { data: Data }) {
  const [catalog, setCatalog] = useState<Data>({ trains: [], total: 0, page: 1, pageSize: 50 })
  const [selectedId, setSelectedId] = useState('')
  const [liveSelected, setLiveSelected] = useState<Data | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    let active = true
    fetch(`${API}/api/catalog/trains?query=${encodeURIComponent(search)}&page=${page}&page_size=50`)
      .then((response) => response.ok ? response.json() : null)
      .then((response) => { if (active && response) setCatalog(response) })
      .catch(() => { if (active) setCatalog({ trains: [], total: 0, page: 1, pageSize: 50, error: 'Directory unavailable' }) })
    return () => { active = false }
  }, [search, page])
  const trains = catalog.trains || []
  const baseSelected = trains.find((train: Data) => train.trainId === selectedId) || trains[0]
  useEffect(() => {
    if (!baseSelected?.trainId) return
    let active = true
    setLiveSelected(null)
    const load = () => fetch(`${API}/api/trains/${baseSelected.trainId}?live=true`)
      .then((response) => response.ok ? response.json() : null)
      .then((prediction) => { if (active && prediction) setLiveSelected(prediction) })
      .catch(() => { /* Cache-first prediction remains visible when unavailable. */ })
    load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [baseSelected?.trainId])
  const selected = liveSelected?.trainId === baseSelected?.trainId ? liveSelected : null
  const pageCount = Math.max(1, Math.ceil((catalog.total || 0) / (catalog.pageSize || 50)))
  return <div className="space-y-6"><section className="panel p-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><p className="eyebrow text-cyan-300">INDIAN RAILWAYS PASSENGER TRAIN BOARD</p><h1 className="mt-2 text-3xl font-black">Find any train</h1><p className="mt-1 text-sm text-slate-400">Original RailRadar directory data. Select a train to load its live running position, route, and ETA.</p></div><span className={`rounded-full px-3 py-2 text-xs font-bold ${catalog.dataSource === 'railradar' ? 'bg-emerald-300/10 text-emerald-300' : 'bg-amber-300/10 text-amber-200'}`}>{catalog.dataSource === 'railradar' ? `${catalog.total.toLocaleString()} ORIGINAL TRAINS` : 'DIRECTORY UNAVAILABLE'}</span></div><div className="mt-5 grid gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.05] p-4 md:grid-cols-[1fr_auto]"><label className="text-xs font-bold uppercase tracking-wider text-slate-400">Search train number or name<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Example: 12603 or Charminar" className="journey-select" /></label><button type="button" onClick={() => { setSearch(''); setPage(1) }} className="action-secondary self-end">Clear search</button></div><div className="mt-4 flex items-center justify-between text-sm"><span className="font-bold text-cyan-200">{catalog.total.toLocaleString()} original trains available</span><span className="text-slate-400">Page {catalog.page || page} of {pageCount}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{trains.map((train: Data) => <button key={train.trainId} onClick={() => setSelectedId(train.trainId)} className={`rounded-2xl border p-4 text-left transition hover:-translate-y-1 ${baseSelected?.trainId === train.trainId ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-white/[.03]'}`}><div className="flex items-center justify-between"><b className="text-cyan-200">{train.trainId}</b><Radio className="h-4 w-4 text-emerald-300" /></div><div className="mt-2 truncate text-sm font-semibold text-slate-200">{train.trainName}</div><div className="mt-2 text-xs text-slate-500">Select to load real-time tracking and ETA.</div></button>)}</div>{trains.length === 0 && <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-100">{catalog.error || 'No trains match this search.'}</div>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="action-secondary disabled:opacity-40">Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="action-primary disabled:opacity-40">Next</button></div></section>{selected && <Passenger data={{ ...data, train: selected }} />}</div>
}

function Passenger({ data }: { data: Data }) {
  const t = data?.train
  const [showAiPrediction, setShowAiPrediction] = useState(false)
  const journeyCompleted = t?.journeyStatus === 'completed'
  const journeyNotStarted = t?.journeyStatus === 'not-started'
  const connecting = t?.dataSource === 'loading' || t?.dataSource === 'warming'
  const originStop = (t?.routeTimeline || [])[0]
  const stationHeading = journeyCompleted ? 'Destination reached' : journeyNotStarted ? normalizeStationName(originStop?.station || t?.currentStation || 'Origin station') : normalizeStationName(t?.nextStation || 'Loading...')
  const stationSection = journeyCompleted ? `Arrived at ${normalizeStationName(t?.currentStation || t?.destinationStation || 'destination')}` : journeyNotStarted ? `Scheduled to depart from ${stationHeading}` : normalizeStationName(t?.section)
  const departureTime = railTime(t?.scheduledDeparture || originStop?.scheduledDeparture)
  const history = (data?.history || []).map((point: Data, index: number) => ({ ...point, eta: Math.max(3, (t?.predictedEtaMinutes || 0) + Math.sin(index / 2) * 3 + index), delay: Math.max(0, (t?.delayMin || 0) + Math.cos(index / 2) * 2), speed: Math.max(0, (t?.speedKmph || 0) + Math.sin(index) * 4) }))
  return <div id="live-details" className="live-train-detail space-y-6">
    <section className="live-detail-header"><div><div className="eyebrow text-cyan-200"><Radio className="h-4 w-4" /> LIVE TRAIN STATUS</div><h1>{t?.trainId || '--'} <span>·</span> {t?.trainName || 'Loading train details'}</h1><p>{connecting ? (t?.operationalStatus || 'Connecting to live RailRadar…') : journeyCompleted ? stationSection : journeyNotStarted ? `${t?.operationalStatus || 'Not started'} · Scheduled departure from ${stationHeading}${departureTime !== '--' ? ` at ${departureTime}` : ''}` : `${t?.operationalStatus || 'Connecting'} · ${t?.isStopped ? `Dwell remaining ${t.dwellRemainingMinutes} min` : `Approaching ${stationHeading} via ${stationSection || '--'}`}`}</p></div><div className="live-status-actions flex flex-wrap items-center gap-2">{t?.dataSource && <span className={`live-source-badge ${t.dataSource === 'railradar' ? 'is-live' : 'is-fallback'}`}>{t.dataSource === 'railradar' ? 'LIVE RAILRADAR' : t.dataSource === 'warming' ? 'WAITING FOR LIVE FEED' : t.dataSource === 'cached' ? 'LATEST CACHED PREDICTION' : 'SIMULATOR FALLBACK'}</span>}<span className="status-divider" aria-hidden="true">·</span><button type="button" className="action-primary" disabled={connecting} onClick={() => setShowAiPrediction((value) => !value)}><BrainCircuit className="h-4 w-4" /> {connecting ? 'AI PREDICTION WAITING' : showAiPrediction ? 'HIDE AI PREDICTION' : 'AI PREDICTION'}</button></div></section>
    {showAiPrediction && <AiPredictionPanel train={t} />}
    <div className="live-summary-grid grid gap-6">
      <section className="next-station-card panel p-6"><p className="eyebrow text-cyan-300">{journeyCompleted ? 'JOURNEY COMPLETE' : journeyNotStarted ? 'SCHEDULED DEPARTURE' : 'NEXT STATION'}</p><h2 className="mt-2 text-3xl font-black">{stationHeading}</h2><p className="text-slate-400">{stationSection}</p><div className="my-8"><span className="text-5xl font-black md:text-6xl">{journeyCompleted ? 'Arrived' : journeyNotStarted ? departureTime : connecting ? 'Waiting…' : formatDuration(t?.predictedEtaMinutes)}</span></div><div className="flex flex-wrap gap-3"><Pill icon={<Gauge />} label={journeyNotStarted ? 'Not started' : connecting ? 'Speed pending' : `${t?.speedKmph?.toFixed?.(0) || '--'} km/h`} /><Pill icon={<AlertTriangle />} label={journeyCompleted ? t?.arrivalPerformance?.label || 'Arrived' : connecting ? 'Delay pending' : `${t?.delayMin?.toFixed?.(0) || '--'} min delay`} tone={journeyCompleted && t?.arrivalPerformance?.minutes <= 0 ? 'green' : 'amber'} /><Pill icon={<BrainCircuit />} label={connecting ? 'Confidence pending' : `${Math.round((t?.confidence || 0) * 100)}% confidence`} tone="green" /></div></section>
      <DestinationEtaCard train={t} journeyCompleted={journeyCompleted} />
    </div>
    <PassengerSafetyIntelligence train={t} />
    <PassengerActions train={t} />
    <EmergencyMode train={t} />
    <EtaChangeReasons train={t} />
    <JourneyTimeline train={t} />
    <Chart title={`${t?.trainId || 'Train'} ETA movement over the last hour`} data={history} lines={['eta', 'delay']} />
  </div>
}

function AiPredictionPanel({ train }: { train: Data }) {
  const previousEtaRef = useRef<string | undefined>()
  const delay = Math.max(0, Math.round(Number(train?.delayMin || 0)))
  const confidence = Math.round(Number(train?.confidence || 0) * 100)
  const destination = train?.destinationStation || 'the destination'
  const eta = train?.destinationEta ? railTime(train.destinationEta) : '--'
  const previousEta = previousEtaRef.current
  if (train?.destinationEta && train.destinationEta !== previousEtaRef.current) previousEtaRef.current = train.destinationEta
  const etaRange = train?.destinationEtaRange || []
  const freshness = train?.lastUpdatedAt ? `${Math.max(0, Math.round((Date.now() - new Date(train.lastUpdatedAt).valueOf()) / 1000))} seconds ago` : 'Live update pending'
  const predictedNext = train?.predictedArrivalAtNextStation ? railTime(train.predictedArrivalAtNextStation) : train?.predictedEtaMinutes != null ? railTime(new Date(Date.now() + Number(train.predictedEtaMinutes) * 60000).toISOString()) : '--'
  const congestionImpact = Math.round(Number(train?.congestion || 0) * 8)
  const impactRows = [
    ['Downstream congestion', congestionImpact],
    ['Existing delay', Math.round(delay * .35)],
    ['Station halt risk', train?.isStopped ? Math.max(1, Number(train?.dwellRemainingMinutes || 3)) : 0],
    ['Weather', ['Rain', 'Heavy Rain', 'Fog'].includes(train?.weather) ? 2 : 0],
    ['Speed recovery', Number(train?.speedKmph || 0) >= 75 && delay > 0 ? -2 : 0],
  ]
  const conditions = [
    ['Current speed', `${Math.round(Number(train?.speedKmph || 0))} km/h`],
    ['Current delay', `${delay} min`],
    ['Congestion', train?.congestion != null ? `${Math.round(Number(train.congestion) * 100)}%` : 'No alert'],
    ['Weather', train?.weather || train?.weatherObservation?.condition || 'Clear'],
  ]
  const explanation = delay > 0
    ? `The model expects ${train?.trainId || 'this train'} to reach ${destination} around ${eta}, carrying forward approximately ${delay} minutes of current delay. It continuously refines this forecast using live position, speed, sectional running time, congestion, signals, weather, and historical delay patterns.`
    : `The model currently expects ${train?.trainId || 'this train'} to reach ${destination} around ${eta}. It is using the live position, speed, route running time, weather, congestion, and historical operating patterns to refresh this forecast.`
  return <section className="panel border-cyan-300/25 bg-cyan-300/[.06] p-5"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><p className="eyebrow text-cyan-200"><BrainCircuit className="h-4 w-4" /> AI PREDICTION</p><h2 className="mt-2 text-2xl font-black">AI forecast for {train?.trainId || 'selected train'}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{explanation}</p></div><div className="rounded-2xl border border-cyan-300/20 bg-slate-950/40 px-4 py-3 text-center"><div className="text-2xl font-black text-cyan-200">{eta}</div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Predicted arrival</div><div className="mt-1 text-xs text-emerald-300">{confidence}% confidence</div></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{conditions.map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[.04] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 font-bold text-slate-100">{value}</div></div>)}</div><div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="eyebrow text-cyan-200">ETA IMPACT BREAKDOWN</p>{impactRows.map(([label, minutes]) => <div key={label} className="mt-2 flex items-center justify-between text-sm"><span className="text-slate-300">{label}</span><b className={Number(minutes) < 0 ? 'text-emerald-300' : Number(minutes) > 0 ? 'text-amber-200' : 'text-slate-500'}>{Number(minutes) > 0 ? '+' : ''}{minutes} min</b></div>)}</div><div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4"><p className="eyebrow text-cyan-200">FORECAST RANGE</p><div className="mt-2 text-sm text-slate-300">Likely arrival window</div><div className="mt-1 text-xl font-black text-cyan-100">{etaRange.length === 2 ? `${railTime(etaRange[0])} – ${railTime(etaRange[1])}` : 'Live range pending'}</div><div className="mt-3 text-sm text-slate-400">Previous ETA: <b className="text-slate-200">{previousEta ? railTime(previousEta) : 'First prediction'}</b> → Current: <b className="text-cyan-200">{eta}</b></div><div className="mt-1 text-xs text-slate-500">Next station ({train?.nextStation || 'upcoming stop'}): {predictedNext}</div></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/[.04] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">DATA FRESHNESS</div><b className="mt-1 block">{freshness}</b><small className="text-slate-500">{train?.dataSource === 'railradar' ? 'RailRadar live observation' : 'Provider update pending'}</small></div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">MODEL TRUST</div><b className="mt-1 block">{train?.model?.model || 'XGBRegressor'}</b><small className="text-slate-500">Typical error: ±{train?.model?.maeMinutes ?? 6} min</small></div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">PASSENGER RECOMMENDATION</div><b className="mt-1 block">{delay >= 20 || Number(train?.congestion || 0) >= .8 ? 'Allow extra time' : 'Monitor normally'}</b><small className="text-slate-500">{delay >= 20 || Number(train?.congestion || 0) >= .8 ? 'Further delay risk is elevated.' : 'No immediate connection warning.'}</small></div></div><p className="mt-4 text-xs text-slate-500">Model output is a forecast, not a railway timetable. It updates when new operational data arrives.</p></section>
}

function PassengerSafetyIntelligence({ train }: { train: Data }) {
  const [profile, setProfile] = useState('')
  const [connectionBuffer, setConnectionBuffer] = useState(30)
  const [scenarioDelay, setScenarioDelay] = useState<number | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const destination = train?.destinationStation || 'destination'
  const delay = Math.max(0, Math.round(Number(train?.delayMin || 0)))
  const connectionRisk = delay >= connectionBuffer ? 'High' : delay >= Math.max(10, connectionBuffer / 2) ? 'Medium' : 'Low'
  const accessibility = {
    Elderly: 'Use the nearest lift and allow extra boarding time. Station assistance can be requested at the help desk.',
    'Wheelchair user': 'Recommended: lift access, step-free platform route, and porter assistance before the train arrives.',
    'Visually impaired': 'Enable spoken guidance and ask station staff to escort you to the coach stopping position.',
    'Child travelling alone': 'Keep the journey details and emergency number 139 ready; use the staffed help desk at the station.',
  } as Record<string, string>
  useEffect(() => {
    const onlineChanged = () => setOnline(navigator.onLine)
    window.addEventListener('online', onlineChanged)
    window.addEventListener('offline', onlineChanged)
    return () => { window.removeEventListener('online', onlineChanged); window.removeEventListener('offline', onlineChanged) }
  }, [])
  useEffect(() => {
    if (!train?.trainId) return
    try { localStorage.setItem(`raileta-last-${train.trainId}`, JSON.stringify({ ...train, cachedAt: new Date().toISOString() })) } catch { /* offline cache is best effort */ }
  }, [train])
  const simulatedEta = train?.destinationEta && scenarioDelay !== null ? railTime(new Date(new Date(train.destinationEta).valueOf() + scenarioDelay * 60000).toISOString()) : null
  return <section className="panel grid gap-5 p-5 xl:grid-cols-[1.2fr_1fr_1fr]">
    <div><p className="eyebrow text-cyan-300">ACCESSIBILITY MODE</p><h3 className="mt-2 text-lg font-bold">Personalised station guidance</h3><div className="mt-3 flex flex-wrap gap-2">{Object.keys(accessibility).map((item) => <button key={item} type="button" className={`action-secondary ${profile === item ? 'border-cyan-300 text-cyan-200' : ''}`} onClick={() => setProfile(item)}>{item}</button>)}</div>{profile && <p className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100">{accessibility[profile]} {profile === 'Wheelchair user' ? 'Walking time will be shown when verified station accessibility mapping is available.' : 'Estimated platform walking time: 6 minutes.'}</p>}</div>
    <div><p className="eyebrow text-cyan-300">MISSED-CONNECTION PREDICTOR</p><h3 className="mt-2 text-lg font-bold">Will I catch my next train?</h3><label className="mt-3 block text-sm text-slate-400">Required connection buffer (minutes)<input className="journey-select mt-1" type="number" min="5" max="180" value={connectionBuffer} onChange={(event) => setConnectionBuffer(Math.max(5, Number(event.target.value) || 5))} /></label><p className={`mt-3 font-bold ${connectionRisk === 'High' ? 'text-rose-300' : connectionRisk === 'Medium' ? 'text-amber-300' : 'text-emerald-300'}`}>{connectionRisk} risk · current delay {delay} min</p><small className="text-slate-400">Based on current delay and your required platform-change buffer.</small></div>
    <div><p className="eyebrow text-cyan-300">DELAY IMPACT SIMULATOR</p><h3 className="mt-2 text-lg font-bold">What if conditions change?</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="action-secondary" onClick={() => setScenarioDelay(10)}>+10 min halt</button><button type="button" className="action-secondary" onClick={() => setScenarioDelay(20)}>Heavy rain</button><button type="button" className="action-secondary" onClick={() => setScenarioDelay(0)}>Clear</button></div>{scenarioDelay !== null && <p className="mt-3 text-sm text-cyan-100">Simulated {scenarioDelay ? `+${scenarioDelay} minutes` : 'normal operation'} · projected {destination} ETA: <b>{simulatedEta || '--'}</b></p>}</div>
    <div className="xl:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><div><p className="eyebrow text-cyan-300">OFFLINE EMERGENCY MODE</p><p className="mt-1 text-sm text-slate-400">{online ? 'Live connection available. Latest train snapshot is cached automatically.' : 'You are offline. Showing the last cached train snapshot and emergency contacts.'}</p></div><span className={`rounded-full px-3 py-2 text-xs font-bold ${online ? 'bg-emerald-300/10 text-emerald-300' : 'bg-amber-300/10 text-amber-200'}`}>{online ? 'ONLINE' : 'OFFLINE FALLBACK READY'}</span></div>
  </section>
}

function PassengerActions({ train }: { train: Data }) {
  const [alertSet, setAlertSet] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const destinationEta = train?.destinationEta ? new Date(train.destinationEta) : null
  const stops = (train?.routeTimeline || []).filter((stop: Data) => !['departed', 'passed'].includes(String(stop.status || '').toLowerCase()))
  const platformStops = stops.filter((stop: Data) => stop.platform)
  const recovery = Number(train?.speedKmph || 0) >= 75 && Number(train?.delayMin || 0) > 0
  const setWakeUpAlert = async () => {
    if (!destinationEta || Number.isNaN(destinationEta.valueOf())) return
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
    const delay = destinationEta.valueOf() - Date.now() - 20 * 60 * 1000
    if (delay <= 0) return setShareMessage('The train is already within 20 minutes of its destination.')
    window.setTimeout(() => { if ('Notification' in window && Notification.permission === 'granted') new Notification(`Wake-up alert: ${train.destinationStation}`, { body: `${train.trainId} is expected to reach the destination in about 20 minutes.` }) }, delay)
    setAlertSet(true)
  }
  const shareTrain = async () => {
    const url = `${window.location.origin}/passenger?train=${encodeURIComponent(train?.trainId || '')}`
    try {
      if (navigator.share) await navigator.share({ title: `${train?.trainId} · ${train?.trainName}`, text: `Track ${train?.trainId} live on RailETA AI`, url })
      else { await navigator.clipboard.writeText(url); setShareMessage('Live tracking link copied.') }
    } catch { setShareMessage('Sharing was cancelled.') }
  }
  return <section className="panel grid gap-4 p-5 lg:grid-cols-[1fr_1fr_1fr]"><div><p className="eyebrow text-cyan-300">SMART ARRIVAL ALERT</p><h3 className="mt-2 text-lg font-bold">Wake me 20 minutes before {train?.destinationStation || 'destination'}</h3><button type="button" className="action-primary mt-3" onClick={setWakeUpAlert} disabled={alertSet || !destinationEta}>{alertSet ? 'Alert scheduled' : 'Set wake-up alert'}</button></div><div><p className="eyebrow text-cyan-300">PLATFORM INTELLIGENCE</p><h3 className="mt-2 text-lg font-bold">{platformStops.length ? `Platform ${platformStops[0].platform} reported` : 'Platform not available yet'}</h3><p className="mt-2 text-sm text-slate-400">{platformStops.length ? 'Allow about 5 minutes to walk from the station entrance. Updates appear when the live feed changes.' : 'RailRadar has not supplied a platform number for the upcoming stops.'}</p></div><div><p className="eyebrow text-cyan-300">SHARE & RECOVERY</p><h3 className="mt-2 text-lg font-bold">{recovery ? 'Recovering lost time' : 'Running normally'}</h3><p className="mt-2 text-sm text-slate-400">{recovery ? 'Higher current speed is helping recover earlier delay.' : 'No active recovery pattern detected.'}</p><button type="button" className="action-secondary mt-3" onClick={shareTrain}>Share live tracking</button>{shareMessage && <small className="mt-2 block text-cyan-200">{shareMessage}</small>}</div></section>
}

function RailIntelligencePanels({ train, fleet }: { train: Data; fleet: Data[] }) {
  const source = train?.dataSource
  const freshness = train?.lastUpdatedAt || train?.updatedAt
  const freshnessText = source === 'railradar' && freshness ? `${Math.max(0, Math.round((Date.now() - new Date(freshness).valueOf()) / 1000))} seconds ago` : source === 'warming' || source === 'loading' ? 'Waiting for RailRadar' : 'Cached / estimated'
  const confidence = Math.round(Number(train?.confidence || 0) * 100)
  const trustReason = source !== 'railradar' ? 'Live provider unavailable' : confidence >= 75 ? 'Fresh live feed with stable telemetry' : confidence >= 55 ? 'Live feed with some operational uncertainty' : 'Limited or changing telemetry'
  const terminal = (train?.routeTimeline || []).at(-1) || {}
  const predicted = train?.destinationEta ? new Date(train.destinationEta).valueOf() : null
  const actual = terminal.actualArrival ? new Date(terminal.actualArrival).valueOf() : null
  const accuracy = predicted && actual && Number.isFinite(predicted) && Number.isFinite(actual) ? `${Math.abs(Math.round((actual - predicted) / 60000))} min error` : 'Available after actual arrival'
  const crowding = train?.crowding || train?.crowdingLevel || 'Not supplied by live feed'
  const affected = (fleet || []).filter((item) => item.trainId !== train?.trainId && Number(item.delayMin || 0) >= 10).slice(0, 4)
  return <section className="panel grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5"><div><p className="eyebrow text-cyan-300">DATA FRESHNESS</p><h3 className="mt-2 text-lg font-bold">{freshnessText}</h3><small className="text-slate-400">{source === 'railradar' ? 'Live RailRadar observation' : 'Not an authoritative live observation'}</small></div><div><p className="eyebrow text-cyan-300">TRUST SCORE</p><h3 className="mt-2 text-lg font-bold">{confidence}% confidence</h3><small className="text-slate-400">{trustReason}</small></div><div><p className="eyebrow text-cyan-300">PREDICTION ACCURACY</p><h3 className="mt-2 text-lg font-bold">{accuracy}</h3><small className="text-slate-400">Compared with actual destination arrival</small></div><div><p className="eyebrow text-cyan-300">CROWDING / COACHES</p><h3 className="mt-2 text-lg font-bold">{crowding}</h3><small className="text-slate-400">Coach occupancy is shown only when supplied by the feed</small></div><div><p className="eyebrow text-cyan-300">DELAY PROPAGATION</p><h3 className="mt-2 text-lg font-bold">{affected.length ? `${affected.length} affected trains` : 'No linked impact detected'}</h3><small className="text-slate-400">{affected.length ? affected.map((item) => `${item.trainId} +${Math.round(item.delayMin)}m`).join(' · ') : 'Based on current fleet telemetry'}</small></div></section>
}

function PassengerJourneyTools({ train }: { train: Data }) {
  const [alarm, setAlarm] = useState<number | null>(null)
  const destination = train?.destinationStation || 'destination'
  const destinationEta = train?.destinationEta ? new Date(train.destinationEta) : null
  const scheduleAlarm = async (minutes: number) => {
    if (!destinationEta || Number.isNaN(destinationEta.valueOf())) return
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
    const wait = destinationEta.valueOf() - Date.now() - minutes * 60 * 1000
    if (wait <= 0) return
    window.setTimeout(() => { if ('Notification' in window && Notification.permission === 'granted') new Notification(`${minutes}-minute destination alert`, { body: `${train?.trainId} reaches ${destination} in about ${minutes} minutes.` }) }, wait)
    setAlarm(minutes)
  }
  const coach = train?.coachPosition || train?.coach || train?.coachNumber
  const platform = (train?.routeTimeline || []).find((stop: Data) => stop.platform)?.platform
  const walkingMinutes = platform ? 5 : null
  const crowding = train?.crowding || train?.crowdingLevel
  return <section className="panel grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4"><div><p className="eyebrow text-cyan-300">DESTINATION ALARMS</p><h3 className="mt-2 text-lg font-bold">Alert before {destination}</h3><div className="mt-3 flex flex-wrap gap-2">{[30, 20, 10, 5].map((minutes) => <button key={minutes} type="button" className="action-secondary" onClick={() => scheduleAlarm(minutes)} disabled={!destinationEta || alarm !== null}>{alarm === minutes ? `${minutes} min set` : `${minutes} min`}</button>)}</div><small className="mt-2 block text-slate-500">Requires notification permission and an open browser session.</small></div><div><p className="eyebrow text-cyan-300">COACH POSITION</p><h3 className="mt-2 text-lg font-bold">{coach ? `Coach ${coach}` : 'Coach position unavailable'}</h3><p className="mt-2 text-sm text-slate-400">{coach ? 'Platform stopping position will be shown when the railway feed supplies coach data.' : 'The live feed has not supplied coach-position data yet.'}</p></div><div><p className="eyebrow text-cyan-300">WALKING NAVIGATION</p><h3 className="mt-2 text-lg font-bold">{platform ? `Platform ${platform}` : 'Platform not available'}</h3><p className="mt-2 text-sm text-slate-400">{walkingMinutes ? `Estimated ${walkingMinutes} minutes from the station entrance.` : 'Walking time will be calculated after platform data arrives.'}</p></div><div><p className="eyebrow text-cyan-300">CROWDING FORECAST</p><h3 className="mt-2 text-lg font-bold">{crowding || 'Unavailable'}</h3><p className="mt-2 text-sm text-slate-400">{crowding ? 'Based on the current railway feed.' : 'Crowding data is not available from the current live feed.'}</p></div></section>
}

function EmergencyMode({ train }: { train: Data }) {
  const [open, setOpen] = useState(false)
  return <section className="panel border-red-300/20 p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="eyebrow text-red-300">EMERGENCY MODE</p><h2 className="mt-2 text-xl font-black">Need railway assistance?</h2><p className="mt-1 text-sm text-slate-400">Keep your train number ready: {train?.trainId || 'selected train'}.</p></div><button type="button" className="action-primary bg-red-500 hover:bg-red-400" onClick={() => setOpen((value) => !value)}>{open ? 'Hide emergency contacts' : 'Show emergency contacts'}</button></div>{open && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><a className="rounded-xl border border-red-300/25 bg-red-300/10 p-4" href="tel:139"><b>139 · Security / medical</b><span className="mt-1 block text-xs text-slate-300">RailMadad assistance</span></a><a className="rounded-xl border border-red-300/25 bg-red-300/10 p-4" href="tel:182"><b>182 · Railway security</b><span className="mt-1 block text-xs text-slate-300">Security helpline</span></a><a className="rounded-xl border border-white/10 bg-white/[.04] p-4" href="https://railmadad.indianrailways.gov.in/madad/feedback.jsp" target="_blank" rel="noopener noreferrer"><b>Lost & found</b><span className="mt-1 block text-xs text-slate-300">Open RailMadad complaint</span></a><a className="rounded-xl border border-white/10 bg-white/[.04] p-4" href="https://railmadad.indianrailways.gov.in/madad/final/ComplaintOnTrain.jsp" target="_blank" rel="noopener noreferrer"><b>Report an incident</b><span className="mt-1 block text-xs text-slate-300">Submit train complaint</span></a></div>}</section>
}

function EtaChangeReasons({ train }: { train: Data }) {
  const observation = train?.weatherObservation
  const reasons = [
    { label: 'Previous delay', minutes: Math.round(Number(train?.delayMin || 0) * .35) },
    { label: 'Congestion', minutes: Math.round(Number(train?.congestion || 0) * 8) },
    { label: 'Extended station halt', minutes: train?.isStopped ? Math.max(1, Number(train?.dwellRemainingMinutes || 3)) : 0 },
    { label: 'Weather', minutes: ['Rain', 'Heavy Rain', 'Fog'].includes(train?.weather) ? 3 : 0 },
    { label: 'Recovery from higher speed', minutes: Number(train?.speedKmph || 0) >= 75 && Number(train?.delayMin || 0) > 0 ? -2 : 0 },
  ]
  const impact = (minutes: number) => minutes > 0 ? `+${minutes} min` : minutes < 0 ? `-${Math.abs(minutes)} min` : '+0 min'
  return <section className="eta-reasons panel p-6"><div><p className="eyebrow text-cyan-300">WHY ETA CHANGED</p><h2 className="mt-2 text-2xl font-black">Live ETA factors</h2><p className="mt-1 text-sm text-slate-400">Current operational inputs used by the ETA prediction.</p>{observation && <div className="live-weather-card"><div><span>LIVE WEATHER</span><b>{observation.condition || train?.weather || '--'}</b><small>{observation.isLive ? 'Open-Meteo current observation' : 'Last known weather'}</small></div><div><b>{observation.temperatureC ?? '--'}°C</b><small>Temperature</small></div><div><b>{observation.precipitationMm ?? '--'} mm</b><small>Rain</small></div><div><b>{observation.windKmph ?? '--'} km/h</b><small>Wind</small></div></div>}</div><div className="eta-reason-list">{reasons.map((reason) => <div key={reason.label}><span>{reason.label}</span><b className={reason.minutes < 0 ? 'recovery' : reason.minutes > 0 ? 'impact' : ''}>{impact(reason.minutes)}</b></div>)}</div></section>
}

function DestinationEtaCard({ train, journeyCompleted }: { train: Data; journeyCompleted: boolean }) {
  const previousEtaRef = useRef<string | undefined>()
  const terminal = (train?.routeTimeline || []).at(-1) || {}
  const scheduled = terminal.scheduledArrival || terminal.scheduledDeparture
  const predicted = train?.destinationEta
  const previousEta = predicted ? previousEtaRef.current : undefined
  if (predicted && predicted !== previousEtaRef.current) previousEtaRef.current = predicted
  const range = train?.destinationEtaRange || []
  const scheduledDate = scheduled ? new Date(scheduled) : null
  const predictedDate = predicted ? new Date(predicted) : null
  const timetableDifference = scheduledDate && predictedDate && !Number.isNaN(scheduledDate.valueOf()) && !Number.isNaN(predictedDate.valueOf()) ? Math.round((predictedDate.valueOf() - scheduledDate.valueOf()) / 60000) : null
  // Provider timetable dates can refer to another operating day. In that case,
  // the live train delay is the only trustworthy passenger-facing comparison.
  const delayMinutes = timetableDifference !== null && Math.abs(timetableDifference) <= 360 ? timetableDifference : Number(train?.delayMin || 0)
  const performance = delayMinutes > 0 ? `+${delayMinutes} min expected delay` : delayMinutes < 0 ? `${Math.abs(delayMinutes)} min early` : 'Expected on time'
  const displayDestination = normalizeStationName(train?.destinationStation || terminal.station || 'Final destination')
  return <section className="destination-eta-card panel p-6"><p className="eyebrow text-amber-200">DESTINATION AI ETA</p><h2 className="mt-2 text-3xl font-black">{displayDestination}</h2><p className="text-slate-400">{journeyCompleted ? 'Journey completed' : predicted ? 'AI-predicted final arrival' : 'AI forecast is updating from the live feed'}</p><div className="my-6"><span className="destination-eta-time">{journeyCompleted ? 'Arrived' : predicted ? railTime(predicted) : 'Updating…'}</span></div><dl className="destination-eta-details"><div><dt>Scheduled arrival</dt><dd>{railTime(scheduled)}</dd></div><div><dt>Previous final ETA</dt><dd>{previousEta ? railTime(previousEta) : 'First prediction'}</dd></div><div><dt>Prediction</dt><dd className={delayMinutes > 0 ? 'delay' : 'early'}>{performance}</dd></div><div><dt>ETA range</dt><dd>{range.length === 2 ? `${railTime(range[0])} - ${railTime(range[1])}` : predicted ? 'Live range unavailable' : 'Waiting for live ETA'}</dd></div><div><dt>Confidence</dt><dd>{Math.round((train?.confidence || 0) * 100)}%</dd></div></dl></section>
}

function railTime(value?: string | null) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function normalizeStationName(value?: string | null) {
  if (!value) return value || ''
  const fixes: Record<string, string> = {
    gajapatinagararn: 'Gajapatinagaram',
    gajapatinagaram: 'Gajapatinagaram',
  }
  return fixes[value.trim().toLowerCase()] || value
}

function formatDuration(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--'
  const minutes = Math.max(0, Math.round(value))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`
}

function JourneyTimeline({ train }: { train: Data }) {
  const stops: Data[] = train?.routeTimeline || []
  const scrollRef = useRef<HTMLDivElement>(null)
  if (!stops.length) return null
  const journeyStatus = String(train?.journeyStatus || 'scheduled').replace(/-/g, ' ')
  const currentIndex = stops.findIndex((stop) => stop.status === 'current' || stop.status === 'at-station')
  const lastDepartedIndex = stops.reduce((latest, stop, index) => stop.status === 'departed' ? index : latest, -1)
  const livePositionIndex = currentIndex >= 0 ? currentIndex : lastDepartedIndex >= 0 ? lastDepartedIndex : 0
  const jumpToLivePosition = () => {
    const container = scrollRef.current
    const position = container?.querySelector<HTMLElement>('#live-train-position')
    if (!container || !position) return
    // Scroll the timeline panel itself, not the page, to keep the current stop in view.
    container.scrollTo({ top: Math.max(0, position.offsetTop - container.clientHeight * .35), behavior: 'smooth' })
    position?.classList.add('live-position-focus')
    window.setTimeout(() => position?.classList.remove('live-position-focus'), 1400)
  }
  const jumpToJourneyEnd = () => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }
  const stationMapUrl = (station: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station} railway station, India`)}`
  return <section className="panel journey-timeline overflow-hidden">
    <div className="flex flex-col justify-between gap-3 border-b border-white/10 p-5 md:flex-row md:items-center">
      <div><p className="eyebrow text-cyan-300"><TrainFront className="h-4 w-4" /> FULL JOURNEY TIMELINE</p><h2 className="mt-2 text-xl font-bold">{train.trainId} from {train.originStation} to {train.destinationStation}</h2><p className="mt-1 text-sm text-slate-400">Select any station name to open its location in Maps.</p></div>
      <span className={`rounded-full px-3 py-2 text-xs font-bold ${journeyStatus === 'running' ? 'bg-emerald-300/10 text-emerald-300' : 'bg-cyan-300/10 text-cyan-200'}`}>{journeyStatus.toUpperCase()}</span>
    </div>
    <div className="grid grid-cols-[76px_minmax(180px,1fr)_76px] gap-3 border-b border-white/10 bg-white/[.03] px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:grid-cols-[130px_minmax(220px,1fr)_130px]"><span>Arrival</span><span>Station</span><span className="text-right">Departure</span></div>
    <div ref={scrollRef} className="journey-timeline-scroll" tabIndex={0} aria-label="Scrollable journey stations">
      <div className="journey-timeline-actions"><button type="button" className="jump-to-live-train" onClick={jumpToLivePosition} title="Go to the train's current position"><TrainFront className="h-5 w-5" /><span>Live position</span></button><button type="button" className="jump-to-live-train journey-end-button" onClick={jumpToJourneyEnd} title="Scroll to final station"><MapPin className="h-5 w-5" /><span>Journey end</span></button></div>
      {stops.map((stop, index) => {
        const isCurrent = stop.status === 'current' || stop.status === 'at-station'
        const isPast = stop.status === 'departed'
        const isFirst = index === 0
        const isLast = index === stops.length - 1
        return <article id={index === livePositionIndex ? 'live-train-position' : undefined} key={`${stop.sequence}-${stop.station}`} className={`grid grid-cols-[76px_minmax(180px,1fr)_76px] gap-3 border-b border-white/5 px-5 py-5 sm:grid-cols-[130px_minmax(220px,1fr)_130px] ${isCurrent ? 'bg-cyan-300/[.07]' : ''}`}>
          <div className="text-xs sm:text-sm"><div className="font-semibold text-slate-200">{isFirst ? 'Start' : railTime(stop.scheduledArrival)}</div><div className="mt-1 text-emerald-300">{isFirst ? '--' : railTime(stop.actualArrival)}</div></div>
          <div className="relative pl-7 before:absolute before:bottom-[-30px] before:left-[7px] before:top-5 before:w-px before:bg-cyan-300/25 last:before:hidden"><span className={`absolute left-0 top-1 h-4 w-4 rounded-full border-4 ${isCurrent ? 'border-cyan-100 bg-cyan-300 shadow-[0_0_18px_#67e8f9]' : isPast ? 'border-emerald-300 bg-emerald-300' : 'border-slate-600 bg-slate-950'}`} /><div className="flex flex-wrap items-center gap-2"><a className="station-map-link" href={stationMapUrl(stop.station)} target="_blank" rel="noopener noreferrer" title={`Open ${stop.station} in Maps`}><b className="text-sm sm:text-base">{stop.station}</b><MapPin className="h-3.5 w-3.5" aria-hidden="true" /></a>{isCurrent && <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[10px] font-bold text-cyan-200">CURRENT</span>}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"><span>{stop.distanceKm ?? '--'} km</span><span>{stop.isHalt ? 'Scheduled halt' : 'Passing station'}</span>{stop.platform && <span className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-1.5 py-0.5 font-bold text-cyan-100">Platform {stop.platform}</span>}</div></div>
          <div className="text-right text-xs sm:text-sm"><div className="font-semibold text-slate-200">{isLast ? 'End' : railTime(stop.scheduledDeparture)}</div><div className="mt-1 text-emerald-300">{isLast ? '--' : railTime(stop.actualDeparture)}</div></div>
        </article>
      })}
    </div>
    <div className="border-t border-white/10 bg-white/[.03] px-5 py-3 text-xs text-slate-400">White: scheduled time · Green: actual reported time · Platform appears when RailRadar has published it. {train.lastUpdatedAt ? `Last provider update: ${railTime(train.lastUpdatedAt)}` : 'Waiting for provider update.'}</div>
  </section>
}

function trainStatus(train: Data) {
  if (train.delayMin >= 20) return 'Critical'
  if (train.delayMin >= 6 && train.speedKmph >= 72) return 'Recovering'
  if (train.delayMin >= 6) return 'Delayed'
  return 'On-time'
}

function statusColor(status: string) {
  return ({ 'On-time': '#34d399', Delayed: '#fbbf24', Critical: '#fb7185', Recovering: '#60a5fa' } as Record<string, string>)[status] || '#67e8f9'
}

function networkAlerts(trains: Data[]) {
  const alerts: Data[] = []
  trains.filter((train) => train.congestion >= .55).slice(0, 2).forEach((train) => alerts.push({ level: 'Congestion', message: `${train.trainId}: congestion on ${train.section} is adding ETA risk.` }))
  trains.filter((train) => train.isStopped).slice(0, 1).forEach((train) => alerts.push({ level: 'Unexpected stop', message: `${train.trainId}: stopped at ${train.currentStation}; dwell is under review.` }))
  trains.filter((train) => train.delayMin >= 20).slice(0, 2).forEach((train) => alerts.push({ level: 'Heavy delay', message: `${train.trainId}: ${train.delayMin.toFixed(0)} min delay, ETA has been recalculated.` }))
  trains.filter((train) => train.speedKmph < 52).slice(0, 1).forEach((train) => alerts.push({ level: 'Speed restriction', message: `${train.trainId}: speed is ${train.speedKmph.toFixed(0)} km/h approaching ${train.nextStation}.` }))
  trains.filter((train) => train.weather === 'Rain').slice(0, 1).forEach((train) => alerts.push({ level: 'Weather impact', message: `${train.trainId}: rain conditions may affect the next section.` }))
  return alerts.slice(0, 6)
}

function LiveNetworkMap({ trains: fallbackTrains, selectedId, onSelect }: { trains: Data[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [network, setNetwork] = useState<Data>({ trains: [] })
  useEffect(() => {
    const refreshNetwork = () => fetch(`${API}/api/network/live?limit=10000`).then((response) => response.ok ? response.json() : null).then((response) => { if (response) setNetwork(response) }).catch(() => undefined)
    refreshNetwork()
    const timer = window.setInterval(refreshNetwork, 60000)
    return () => window.clearInterval(timer)
  }, [])
  const trains: Data[] = network.dataSource === 'railradar' && network.trains?.length ? network.trains : fallbackTrains
  return <div className="network-map"><MapContainer center={[20.5, 79.0]} zoom={5} scrollWheelZoom className="h-full w-full"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{trains.map((train) => { const status = trainStatus(train); return <CircleMarker key={train.trainId} center={[train.latitude, train.longitude]} radius={selectedId === train.trainId ? 12 : 8} pathOptions={{ color: '#07111f', weight: 2, fillColor: statusColor(status), fillOpacity: .95 }} eventHandlers={{ click: () => onSelect(train.trainId) }}><Popup><strong>{train.trainId} · {train.trainName}</strong><br />{train.currentStation} to {train.nextStation}<br />{status} · {train.speedKmph?.toFixed?.(0) || '--'} km/h · {train.delayMin?.toFixed?.(0) || '--'} min delay</Popup></CircleMarker>})}</MapContainer><div className="map-legend">{['On-time', 'Delayed', 'Critical', 'Recovering'].map((status) => <span key={status}><i style={{ background: statusColor(status) }} />{status}</span>)}</div></div>
}

function ControlFleetTable({ trains, selectedId, onSelect }: { trains: Data[]; selectedId?: string; onSelect: (id: string) => void }) {
  const statusData = ['On-time', 'Delayed', 'Critical', 'Recovering'].map((name) => ({ name, value: trains.filter((train) => trainStatus(train) === name).length, color: statusColor(name) }))
  const causeData = [
    { name: 'Congestion', minutes: Math.round(trains.reduce((sum, train) => sum + train.congestion * 8, 0) / Math.max(trains.length, 1)) },
    { name: 'Previous delay', minutes: Math.round(trains.reduce((sum, train) => sum + train.delayMin * .35, 0) / Math.max(trains.length, 1)) },
    { name: 'Extended dwell', minutes: trains.filter((train) => train.isStopped).length ? 3 : 1 },
    { name: 'Weather', minutes: trains.filter((train) => train.weather === 'Rain').length ? 3 : 0 },
  ]
  return <><section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 p-5"><div><p className="eyebrow text-cyan-300">LIVE TRAIN STATUS</p><h2 className="mt-2 text-xl font-bold">All running coaching trains</h2></div><span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-300">{trains.length} LIVE</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-white/[.03] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Train number</th><th className="px-5 py-3">Route</th><th className="px-5 py-3">Current location</th><th className="px-5 py-3">Speed</th><th className="px-5 py-3">Delay</th><th className="px-5 py-3">Next station</th><th className="px-5 py-3">AI ETA</th><th className="px-5 py-3">Status</th></tr></thead><tbody>{trains.map((train) => { const status = trainStatus(train); return <tr key={train.trainId} onClick={() => onSelect(train.trainId)} className={`cursor-pointer border-t border-white/5 hover:bg-white/[.04] ${selectedId === train.trainId ? 'bg-cyan-300/[.06]' : ''}`}><td className="px-5 py-3 font-bold text-cyan-200">{train.trainId}</td><td className="max-w-[240px] px-5 py-3 text-slate-300"><div className="truncate">{train.originStation} to {train.destinationStation}</div></td><td className="px-5 py-3">{train.currentStation}</td><td className="px-5 py-3">{train.speedKmph.toFixed(0)} km/h</td><td className="px-5 py-3">{train.delayMin.toFixed(0)} min</td><td className="px-5 py-3">{train.nextStation}</td><td className="px-5 py-3 font-bold">{train.predictedEtaMinutes.toFixed(0)} min</td><td className="px-5 py-3"><span className="status-pill" style={{ color: statusColor(status), borderColor: `${statusColor(status)}66`, backgroundColor: `${statusColor(status)}16` }}>{status}</span></td></tr>})}</tbody></table></div></section><div className="grid gap-6 xl:grid-cols-2"><section className="panel p-5"><p className="eyebrow text-cyan-300">TRAIN STATUS DISTRIBUTION</p><h2 className="mt-2 text-xl font-bold">Current fleet condition</h2><div className="mt-4 h-64"><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={3}>{statusData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} /><Legend /></PieChart></ResponsiveContainer></div></section><section className="panel p-5"><p className="eyebrow text-cyan-300">NETWORK DELAY CAUSES</p><h2 className="mt-2 text-xl font-bold">Estimated delay contribution</h2><div className="mt-4 h-64"><ResponsiveContainer><BarChart data={causeData} layout="vertical"><CartesianGrid stroke="#ffffff10" horizontal={false} /><XAxis type="number" stroke="#64748b" fontSize={11} unit=" min" /><YAxis type="category" dataKey="name" width={110} stroke="#94a3b8" fontSize={11} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} formatter={(value) => [`${value} min`, 'ETA impact']} /><Bar dataKey="minutes" fill="#fbbf24" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer></div></section></div></>
}

function ControlDashboard({ data }: { data: Data }) {
  const [role, setRole] = useState<'operator' | 'supervisor' | null>(() => (localStorage.getItem('raileta-control-role') as 'operator' | 'supervisor' | null) || null)
  const chooseRole = (nextRole: 'operator' | 'supervisor') => { localStorage.setItem('raileta-control-role', nextRole); setRole(nextRole) }
  if (!role) return <section className="mx-auto max-w-3xl panel p-8"><p className="eyebrow text-cyan-300">CONTROL ROOM ACCESS</p><h1 className="mt-3 text-3xl font-black">Choose your operational role</h1><p className="mt-2 text-slate-400">RailETA Control Room supports Operator and Supervisor access only.</p><div className="mt-6 grid gap-4 md:grid-cols-2"><button type="button" className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-5 text-left" onClick={() => chooseRole('operator')}><b className="text-xl text-cyan-200">Operator</b><p className="mt-2 text-sm text-slate-300">Monitor live trains, acknowledge alerts, update incidents, and report platform or route changes.</p></button><button type="button" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5 text-left" onClick={() => chooseRole('supervisor')}><b className="text-xl text-amber-200">Supervisor</b><p className="mt-2 text-sm text-slate-300">All Operator permissions plus approvals, simulations, escalations, analytics, and emergency announcements.</p></button></div></section>
  const trains = data?.fleet || []
  const [selectedId, setSelectedId] = useState('12603')
  const selected = trains.find((train: Data) => train.trainId === selectedId) || trains[0]
  const active = trains.filter((train: Data) => train.speedKmph > 1).length
  const onTime = trains.filter((train: Data) => train.delayMin < 6).length
  const delayed = trains.filter((train: Data) => train.delayMin >= 6 && train.delayMin < 20).length
  const critical = trains.filter((train: Data) => train.delayMin >= 20).length
  const averageDelay = trains.length ? trains.reduce((sum: number, train: Data) => sum + train.delayMin, 0) / trains.length : 0
  const alerts = networkAlerts(trains)
  const etaSeries = (data?.history || []).slice().reverse().map((point: Data, index: number) => ({ time: `T-${(11 - index) * 5}m`, scheduled: Math.max(4, point.eta - (selected?.delayMin || 0)), ai: point.eta }))
  const trend = (data?.history || []).slice().reverse().map((point: Data, index: number) => ({ time: `T-${(11 - index) * 5}m`, averageDelay: Math.max(0, averageDelay + Math.sin(index / 2) * 2.5), onTime: Math.max(0, Math.min(100, (onTime / Math.max(trains.length, 1)) * 100 + Math.cos(index / 2) * 4)) }))
  const causes = selected ? [{ label: 'Congestion', value: Math.round(selected.congestion * 8) }, { label: 'Previous delay', value: Math.round(selected.delayMin * .35) }, { label: 'Extended dwell', value: selected.isStopped ? 3 : 1 }, { label: 'Weather', value: selected.weather === 'Rain' ? 3 : 0 }] : []
  return <div className="space-y-6"><section className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><div className="eyebrow text-cyan-300"><Activity className="h-4 w-4" /> CONTROL ROOM / LIVE OPERATIONS</div><h1 className="mt-3 text-4xl font-black">Andhra network dashboard</h1><p className="mt-2 text-slate-400">Automatic train ingestion, live AI ETA predictions, and operational alerts.</p></div><span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-200">DEMO MODE - Simulated operational data</span></section><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Active trains" value={`${active}`} icon={<TrainFront />} tone="green" /><Metric label="On-time trains" value={`${onTime}`} icon={<Activity />} tone="green" /><Metric label="Delayed trains" value={`${delayed}`} icon={<Clock3 />} tone="amber" /><Metric label="Critical trains" value={`${critical}`} icon={<AlertTriangle />} tone="amber" /><Metric label="Average network delay" value={`${averageDelay.toFixed(1)} min`} icon={<Gauge />} /></div><div className="grid gap-6 xl:grid-cols-[1.55fr_.65fr]"><section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 p-5"><div><p className="eyebrow text-cyan-300"><MapPin className="h-4 w-4" /> LIVE NETWORK MAP</p><h2 className="mt-2 text-xl font-bold">All running trains</h2></div><span className="text-xs text-slate-400">Click a train marker for details</span></div><LiveNetworkMap trains={trains} selectedId={selected?.trainId} onSelect={setSelectedId} /></section><section className="panel p-5"><p className="eyebrow text-cyan-300">SELECTED TRAIN</p><h2 className="mt-2 text-2xl font-black">{selected?.trainId || '--'}</h2><p className="mt-1 text-sm text-slate-400">{selected?.trainName || 'Waiting for live data'}</p><div className="mt-6 space-y-4 text-sm"><div className="rounded-2xl bg-white/[.04] p-4"><span className="text-slate-500">Current location</span><b className="mt-1 block">{selected?.currentStation || '--'}</b><span className="mt-1 block text-xs text-slate-400">Next: {selected?.nextStation || '--'}</span></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/[.04] p-3"><span className="text-xs text-slate-500">Speed</span><b className="mt-1 block">{selected?.speedKmph?.toFixed?.(0) || '--'} km/h</b></div><div className="rounded-xl bg-white/[.04] p-3"><span className="text-xs text-slate-500">AI ETA</span><b className="mt-1 block">{selected?.predictedEtaMinutes?.toFixed?.(0) || '--'} min</b></div></div><span className="status-pill" style={{ color: statusColor(trainStatus(selected || {})), borderColor: `${statusColor(trainStatus(selected || {}))}66`, backgroundColor: `${statusColor(trainStatus(selected || {}))}16` }}>{selected ? trainStatus(selected) : 'Connecting'}</span></div></section></div><ControlFleetTable trains={trains} selectedId={selected?.trainId} onSelect={setSelectedId} /><div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><section className="panel p-5"><p className="eyebrow text-cyan-300"><BrainCircuit className="h-4 w-4" /> AI PREDICTION OVERVIEW</p><h2 className="mt-2 text-xl font-bold">{selected?.trainId || '--'} prediction snapshot</h2><div className="mt-5 grid grid-cols-2 gap-3"><div className="metric-tile"><span>Scheduled ETA</span><b>{Math.max(0, (selected?.predictedEtaMinutes || 0) - (selected?.delayMin || 0)).toFixed(0)} min</b></div><div className="metric-tile"><span>AI ETA</span><b>{selected?.predictedEtaMinutes?.toFixed?.(0) || '--'} min</b></div><div className="metric-tile"><span>Predicted delay</span><b>{selected?.delayMin?.toFixed?.(0) || '--'} min</b></div><div className="metric-tile"><span>Confidence</span><b>{Math.round((selected?.confidence || 0) * 100)}%</b></div></div><div className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[.06] p-4 text-sm"><b className="text-cyan-200">{trains.length} predictions generated</b><span className="text-slate-400"> across the current fleet cycle</span></div></section><section className="panel p-5"><p className="eyebrow text-cyan-300"><Bell className="h-4 w-4" /> LIVE ALERTS</p><div className="mt-4 space-y-2">{alerts.length ? alerts.map((alert, index) => <div key={`${alert.level}-${index}`} className="rounded-xl border border-amber-300/15 bg-amber-300/[.06] p-3"><b className="text-xs uppercase tracking-wider text-amber-200">{alert.level}</b><p className="mt-1 text-sm text-slate-300">{alert.message}</p></div>) : <p className="text-sm text-emerald-300">No operational alerts in this update.</p>}</div></section></div><div className="grid gap-6 xl:grid-cols-2"><section className="panel p-5"><p className="eyebrow text-cyan-300">ETA PREDICTION CHART</p><h2 className="mt-2 text-xl font-bold">Scheduled ETA vs AI-predicted ETA</h2><div className="mt-5 h-72"><ResponsiveContainer><ComposedChart data={etaSeries}><CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="time" stroke="#64748b" fontSize={10} /><YAxis stroke="#64748b" fontSize={11} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} /><Legend /><Line dataKey="scheduled" name="Scheduled ETA" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} /><Line dataKey="ai" name="AI ETA" stroke="#67e8f9" strokeWidth={3} dot={false} /></ComposedChart></ResponsiveContainer></div></section><section className="panel p-5"><p className="eyebrow text-cyan-300">NETWORK DELAY TREND</p><h2 className="mt-2 text-xl font-bold">Average delay and on-time percentage</h2><div className="mt-5 h-72"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="time" stroke="#64748b" fontSize={10} /><YAxis stroke="#64748b" fontSize={11} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} /><Legend /><Area type="monotone" dataKey="averageDelay" name="Average delay (min)" stroke="#fbbf24" fill="#fbbf2433" /><Line type="monotone" dataKey="onTime" name="On-time %" stroke="#34d399" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></div></section></div><section className="panel p-5"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="eyebrow text-cyan-300"><BrainCircuit className="h-4 w-4" /> WHY ETA CHANGED?</p><h2 className="mt-2 text-xl font-bold">{selected?.trainId || '--'} ETA impact breakdown</h2></div><p className="text-sm text-slate-400">AI confidence: {Math.round((selected?.confidence || 0) * 100)}%</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{causes.map((cause) => <div key={cause.label} className="metric-tile"><span>{cause.label}</span><b>+{cause.value} min</b></div>)}</div></section></div>
}

function Control({ data, refresh }: { data: Data; refresh: () => Promise<void> }) { const t = data?.train; const [whatIf, setWhatIf] = useState<Data | null>(null); const tick = async () => { await fetch(`${API}/api/simulate/tick`, { method: 'POST' }); await refresh() }; const inject = async () => { await fetch(`${API}/api/simulate/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ train_id: '12603', event_type: 'weather_change', weather: 'Rain', delay_min: (t?.delayMin || 0) + 8 }) }); await refresh() }; const scenario = async () => { const r = await fetch(`${API}/api/what-if`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ train_id: '12603', speed_kmph: 55, congestion: .8, weather: 'Rain' }) }); setWhatIf((await r.json()).scenario) }; return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="eyebrow text-cyan-300"><Settings2 className="h-4 w-4" /> CONTROL ROOM / LIVE OPERATIONS</div><h1 className="mt-3 text-4xl font-black">Network view</h1><p className="mt-2 text-slate-400">Fleet monitoring for {data?.fleetCount || 20} coaching trains.</p></div><div className="flex gap-2"><button onClick={tick} className="action-primary">Run simulator tick</button><button onClick={inject} className="action-secondary">Inject rain event</button></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active fleet" value={`${data?.fleetCount || 20} trains`} icon={<TrainFront />} /><Metric label="Featured ETA" value={`${t?.predictedEtaMinutes?.toFixed?.(1) || '--'} min`} icon={<Clock3 />} /><Metric label="Featured delay" value={`${t?.delayMin?.toFixed?.(0) || '--'} min`} icon={<Activity />} tone="amber" /><Metric label="Confidence" value={`${Math.round((t?.confidence || 0) * 100)}%`} icon={<BrainCircuit />} tone="green" /></div><FleetTable trains={data?.fleet || []} /><div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]"><RouteMap data={data} /><section className="panel p-5"><p className="eyebrow text-cyan-300">ACTIVE ALERTS</p><div className="mt-4 space-y-3">{(data?.alerts || []).map((a: Data, i: number) => <div key={i} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4"><div className="text-xs font-black uppercase">{a.level}</div><p className="mt-2 text-sm">{a.message}</p></div>)}</div><button onClick={scenario} className="action-secondary mt-5 w-full">Run what-if: rain + congestion</button>{whatIf && <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-cyan-200">Scenario ETA: {whatIf.predictedEtaMinutes.toFixed(1)} min · confidence {Math.round(whatIf.confidence * 100)}%</div>}</section></div><div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]"><Chart title="Speed, delay, and ETA correlation" data={data?.history || []} lines={['speed', 'eta', 'delay']} /><section className="panel p-5"><p className="eyebrow text-cyan-300">STATION FORECAST</p><h2 className="mt-2 text-xl font-bold">Featured route minutes</h2><div className="mt-5 h-80"><ResponsiveContainer><BarChart data={t?.stationForecasts || []} layout="vertical"><CartesianGrid stroke="#ffffff10" horizontal={false} /><XAxis type="number" stroke="#64748b" /><YAxis type="category" dataKey="station" width={90} stroke="#94a3b8" fontSize={10} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} /><Bar dataKey="etaMinutes" fill="#22d3ee" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer></div></section></div><div className="panel p-5 text-sm text-slate-400"><BrainCircuit className="mr-2 inline text-cyan-300" /> Model: <b className="text-slate-200">{data?.model?.model}</b> · validation MAE <b className="text-slate-200">{data?.model?.maeMinutes} min</b> · artifact {data?.model?.artifact}</div></div> }

function FleetTable({ trains }: { trains: Data[] }) { return <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 p-5"><div><p className="eyebrow text-cyan-300">FLEET MONITOR</p><h2 className="mt-2 text-xl font-bold">All coaching trains</h2></div><span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-300">{trains.length || 20} LIVE</span></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-white/[.03] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Train</th><th className="px-5 py-3">Section</th><th className="px-5 py-3">Speed</th><th className="px-5 py-3">Delay</th><th className="px-5 py-3">Next ETA</th><th className="px-5 py-3">Confidence</th><th className="px-5 py-3">Condition</th></tr></thead><tbody>{trains.map((t: Data) => <tr key={t.trainId} className="border-t border-white/5 hover:bg-white/[.03]"><td className="px-5 py-3"><b className="text-cyan-200">{t.trainId}</b><div className="max-w-[210px] truncate text-xs text-slate-500">{t.trainName}</div></td><td className="px-5 py-3 text-slate-300">{t.section}</td><td className="px-5 py-3">{t.speedKmph.toFixed(0)} km/h</td><td className={`px-5 py-3 font-bold ${t.delayMin >= 10 ? 'text-red-300' : t.delayMin >= 6 ? 'text-amber-300' : 'text-emerald-300'}`}>{t.delayMin.toFixed(0)} min</td><td className="px-5 py-3 font-bold">{t.predictedEtaMinutes.toFixed(1)} min</td><td className="px-5 py-3">{Math.round(t.confidence * 100)}%</td><td className="px-5 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-xs">{t.weather}</span></td></tr>)}</tbody></table></div></section> }

function Chart({ title, data, lines }: { title: string; data: Data[]; lines: string[] }) { const colors: Record<string, string> = { eta: '#67e8f9', delay: '#fbbf24', speed: '#34d399' }; return <section className="panel p-5"><p className="eyebrow text-cyan-300">TELEMETRY</p><h2 className="mt-2 text-xl font-bold">{title}</h2><div className="mt-5 h-72"><ResponsiveContainer><ComposedChart data={data.slice().reverse()}><CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="time" hide /><YAxis stroke="#64748b" fontSize={11} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />{lines.map((line) => <Line key={line} dataKey={line} stroke={colors[line]} strokeWidth={2.5} dot={false} />)}</ComposedChart></ResponsiveContainer></div></section> }
function RouteMap({ data: _data }: { data: Data }) { return null }
function Metric({ label, value, icon, tone = 'cyan' }: { label: string; value: string; icon: ReactNode; tone?: string }) { return <div className="panel p-5"><div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${tone === 'amber' ? 'text-amber-300' : tone === 'green' ? 'text-emerald-300' : 'text-cyan-300'}`}>{icon}{label}</div><div className="mt-3 text-3xl font-black">{value}</div></div> }
function Pill({ icon, label, tone = 'cyan' }: { icon: ReactNode; label: string; tone?: string }) { return <div className={`flex items-center gap-2 rounded-full border px-3 py-2 ${tone === 'amber' ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : tone === 'green' ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200'}`}>{icon}<span>{label}</span></div> }
