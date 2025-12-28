'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, LogOut, Save, Upload, Plus, Trash2, Edit, MessageSquare, BarChart3, Users, MessageCircle, Clock, Settings, User, LayoutDashboard, Search, ChevronLeft, ChevronRight, Filter, X, Check, Send } from 'lucide-react';
import Image from 'next/image';

interface DocumentSource {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'txt'
  content: string
  enabled: boolean
  category?: string
  tags?: string[]
  uploadedAt: string
}

interface URLSource {
  id: string
  url: string
  title: string
  content: string
  enabled: boolean
  category?: string
  tags?: string[]
  scrapedAt: string
}

interface StructuredDataSource {
  id: string
  name: string
  type: 'products' | 'pricing' | 'services' | 'catalog'
  data: any
  enabled: boolean
  category?: string
  tags?: string[]
  createdAt: string
}

interface TelegramSettings {
  enabled?: boolean
  botToken?: string
  botUsername?: string
  webhookUrl?: string
  webhookSetAt?: string
}

interface MessengerSettings {
  enabled?: boolean
  pageAccessToken?: string
  verifyToken?: string
  appSecret?: string
  pageId?: string
  pageName?: string
  webhookUrl?: string
  webhookSetAt?: string
}

interface WhatsAppSettings {
  enabled?: boolean
  accessToken?: string
  phoneNumberId?: string
  businessAccountId?: string
  verifyToken?: string
  webhookUrl?: string
  webhookSetAt?: string
  phoneNumber?: string
  verifiedName?: string
}

interface BotSettings {
  _id?: string
  botId: string
  name: string
  welcomeMessage: string
  themeColor: string
  webType?: 'web' | 'web-advance'
  faqs: string[]
  documents: DocumentSource[]
  urls: URLSource[]
  structuredData: StructuredDataSource[]
  categories: string[]
  telegram?: TelegramSettings
  messenger?: MessengerSettings
  whatsapp?: WhatsAppSettings
  createdAt?: string
}

interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalBots: number
  limit: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [bots, setBots] = useState<BotSettings[]>([])
  const [selectedBot, setSelectedBot] = useState<BotSettings | null>(null)
  const [faqText, setFaqText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedBotId, setCopiedBotId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [activeTab, setActiveTab] = useState<'faq' | 'documents' | 'urls' | 'structured' | 'telegram' | 'messenger' | 'whatsapp'>('faq')
  const [newUrl, setNewUrl] = useState('')
  const [newUrlCategory, setNewUrlCategory] = useState('')
  const [newUrlTags, setNewUrlTags] = useState('')
  const [newStructuredName, setNewStructuredName] = useState('')
  const [newStructuredType, setNewStructuredType] = useState<'products' | 'pricing' | 'services' | 'catalog'>('products')
  const [newStructuredData, setNewStructuredData] = useState('')
  const [newStructuredCategory, setNewStructuredCategory] = useState('')
  const [newStructuredTags, setNewStructuredTags] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [analytics, setAnalytics] = useState<{
    stats?: {
      messagesSent: number
      chatOpens: number
      totalInteractions: number
      uniqueSessions: number
    }
    events?: any[]
  } | null>(null)
  const [newBot, setNewBot] = useState({
    botId: '',
    name: '',
    welcomeMessage: 'Xin chào anh chị! mình cần em tư vấn gì ạ?',
    themeColor: '#3B82F6',
    webType: 'web' as 'web' | 'web-advance',
    faqs: [],
    documents: [],
    urls: [],
    structuredData: [],
    categories: []
  })
  
  // Pagination and search state
  const [pagination, setPagination] = useState<PaginationInfo>({
    currentPage: 1,
    totalPages: 1,
    totalBots: 0,
    limit: 10,
    hasNextPage: false,
    hasPrevPage: false
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [allBots, setAllBots] = useState<BotSettings[]>([])
  const [displayedBots, setDisplayedBots] = useState<BotSettings[]>([])
  const [botsToShow, setBotsToShow] = useState(10)
  
  // Modal state
  const [showEmbedModal, setShowEmbedModal] = useState(false)
  const [embedCodeCopied, setEmbedCodeCopied] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [botToDelete, setBotToDelete] = useState<BotSettings | null>(null)
  
  // Message states
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isCreatingBot, setIsCreatingBot] = useState(false)
  
  // Preview chat state
  const [showPreview, setShowPreview] = useState(false)
  const [previewMessages, setPreviewMessages] = useState<Array<{id: string, text: string, isUser: boolean, timestamp: Date}>>([])
  const [previewInput, setPreviewInput] = useState('')
  
  // Telegram state
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramWebhookUrl, setTelegramWebhookUrl] = useState('')
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [telegramBotInfo, setTelegramBotInfo] = useState<any>(null)
  
  // Messenger state
  const [messengerPageToken, setMessengerPageToken] = useState('')
  const [messengerVerifyToken, setMessengerVerifyToken] = useState('')
  const [messengerAppSecret, setMessengerAppSecret] = useState('')
  const [messengerWebhookUrl, setMessengerWebhookUrl] = useState('')
  const [messengerLoading, setMessengerLoading] = useState(false)
  const [messengerPageInfo, setMessengerPageInfo] = useState<any>(null)
  const [showMessengerCustomWebhook, setShowMessengerCustomWebhook] = useState(false)
  const [showCustomWebhook, setShowCustomWebhook] = useState(false)
  
  // WhatsApp Web state
  const [whatsappLoading, setWhatsappLoading] = useState(false)
  const [whatsappQRCode, setWhatsappQRCode] = useState<string | null>(null)
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    } else if (status === 'authenticated') {
      loadBots()
    }
  }, [status, router])

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchInput !== searchQuery) {
        setSearchQuery(searchInput)
        setPagination(prev => ({ ...prev, currentPage: 1 }))
        loadBots(1, searchInput, sortBy, sortOrder)
      }
    }, 300) // 300ms delay

    return () => clearTimeout(timeoutId)
  }, [searchInput])

  // Update displayed bots when allBots or botsToShow changes
  useEffect(() => {
    setDisplayedBots(allBots.slice(0, botsToShow))
    setBots(allBots.slice(0, botsToShow))
  }, [allBots, botsToShow])


  const loadBots = async (page = 1, search = '', sortByField = 'createdAt', sortOrderField = 'desc', loadMore = false) => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '100', // Load more bots at once
        search,
        sortBy: sortByField,
        sortOrder: sortOrderField
      })
      
      const response = await fetch(`/api/bots?${params}`)
      if (response.ok) {
        const data = await response.json()
        
        if (loadMore) {
          // Append new bots to existing list
          setAllBots(prev => [...prev, ...data.bots])
        } else {
          // Replace all bots (new search or initial load)
          setAllBots(data.bots)
          setBotsToShow(10) // Reset to show first 10
        }
        
        setPagination(data.pagination)
        
        // Select first bot if none selected and bots are available
        if (data.bots.length > 0 && !selectedBot) {
          selectBot(data.bots[0])
        } else if (selectedBot) {
          // Reload selected bot data if it exists (for F5 refresh)
          const currentBot = data.bots.find((b: BotSettings) => b.botId === selectedBot.botId)
          if (currentBot) {
            selectBot(currentBot)
          }
        }
      }
    } catch (error) {
      console.error('Error loading bots:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const createBot = async () => {
    // Xóa các thông báo trước đó
    setErrorMessage('')
    setSuccessMessage('')
    setIsCreatingBot(true)

    if (!newBot.botId || !newBot.name) {
      setErrorMessage('ID Bot và tên là bắt buộc')
      setTimeout(() => setErrorMessage(''), 5000)
      setIsCreatingBot(false)
      return
    }

    try {
      const response = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBot),
      })

      if (response.ok) {
        const createdBot = await response.json()
        // Thêm bot mới vào đầu danh sách
        setAllBots(prev => [createdBot, ...prev])
        setSelectedBot(createdBot)
        setFaqText('')
        setNewBot({
          botId: '',
          name: '',
          welcomeMessage: 'Xin chào! Tôi có thể giúp gì cho bạn hôm nay?',
          themeColor: '#3B82F6',
          webType: 'web',
          faqs: [],
          documents: [],
          urls: [],
          structuredData: [],
          categories: []
        })
        setSuccessMessage('Tạo bot thành công!')
        setTimeout(() => {
          setSuccessMessage('')
          setShowCreateForm(false)
        }, 2000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể tạo bot. Vui lòng thử lại.')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi mạng. Vui lòng kiểm tra kết nối của bạn và thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setIsCreatingBot(false)
    }
  }

  const openDeleteModal = (bot: BotSettings) => {
    setBotToDelete(bot)
    setShowDeleteModal(true)
  }

  const confirmDeleteBot = async () => {
    if (!botToDelete) return

    // Clear previous messages
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch(`/api/bots/${botToDelete.botId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Remove bot from the list
        setAllBots(prev => prev.filter(bot => bot.botId !== botToDelete.botId))
        if (selectedBot?.botId === botToDelete.botId) {
          setSelectedBot(null)
          setFaqText('')
        }
        setSuccessMessage('Agent đã được xóa thành công!')
        setTimeout(() => setSuccessMessage(''), 3000)
        setShowDeleteModal(false)
        setBotToDelete(null)
      } else {
        setErrorMessage('Không thể xóa Agent. Vui lòng thử lại.')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi mạng. Vui lòng kiểm tra kết nối và thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const cancelDeleteBot = () => {
    setShowDeleteModal(false)
    setBotToDelete(null)
  }

  const selectBot = async (bot: BotSettings) => {
    setSelectedBot(bot)
    setFaqText(bot.faqs ? bot.faqs.join('\n\n') : '')
    setTelegramToken(bot.telegram?.botToken || '')
    setTelegramWebhookUrl('')
    setTelegramBotInfo(null)
    setMessengerPageToken(bot.messenger?.pageAccessToken || '')
    setMessengerVerifyToken(bot.messenger?.verifyToken || '')
    setMessengerAppSecret(bot.messenger?.appSecret || '')
    setMessengerWebhookUrl('')
    setMessengerPageInfo(null)
    setWhatsappQRCode(null)
    setWhatsappStatus(null)
    loadAnalytics(bot.botId)
    
    // Load full bot data from API to ensure we have latest settings
    try {
      const response = await fetch(`/api/bot-settings?botId=${bot.botId}`)
      if (response.ok) {
        const fullBotData = await response.json()
        setSelectedBot(fullBotData)
        setTelegramToken(fullBotData.telegram?.botToken || '')
        setMessengerPageToken(fullBotData.messenger?.pageAccessToken || '')
        setMessengerVerifyToken(fullBotData.messenger?.verifyToken || '')
        setMessengerAppSecret(fullBotData.messenger?.appSecret || '')
        
        // If bot has telegram token and is enabled, load bot info automatically
        if (fullBotData.telegram?.botToken && fullBotData.telegram?.enabled) {
          try {
            const botInfoResponse = await fetch('/api/telegram/bot-info', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: fullBotData.telegram.botToken })
            })
            if (botInfoResponse.ok) {
              const botInfo = await botInfoResponse.json()
              setTelegramBotInfo(botInfo)
            }
          } catch (error) {
            console.error('Error loading telegram bot info:', error)
          }
        }
        
        // If bot has messenger token and is enabled, load page info automatically
        if (fullBotData.messenger?.pageAccessToken && fullBotData.messenger?.enabled) {
          try {
            const pageInfoResponse = await fetch('/api/messenger/page-info', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageAccessToken: fullBotData.messenger.pageAccessToken })
            })
            if (pageInfoResponse.ok) {
              const pageInfo = await pageInfoResponse.json()
              setMessengerPageInfo(pageInfo)
            }
          } catch (error) {
            console.error('Error loading messenger page info:', error)
          }
        }
      }
    } catch (error) {
      console.error('Error loading full bot data:', error)
    }
  }

  const loadAnalytics = async (botId: string) => {
    try {
      const response = await fetch(`/api/analytics?botId=${botId}`)
      if (response.ok) {
        const data = await response.json()
        setAnalytics(data)
      }
    } catch (error) {
      console.error('Error loading analytics:', error)
    }
  }

  const handleSaveSettings = async () => {
    if (!selectedBot) return

    const faqLines = faqText.split('\n\n').filter(faq => faq.trim())
    const faqs = faqLines.map(faq => {
      return faq.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ')
    })
    
    const updatedSettings = { 
      ...selectedBot, 
      faqs,
      documents: selectedBot.documents || [],
      urls: selectedBot.urls || [],
      structuredData: selectedBot.structuredData || [],
      categories: selectedBot.categories || []
    }
    console.log('Saving bot settings:', updatedSettings)
    setSelectedBot(updatedSettings)
    
    try {
      const response = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      })

      if (response.ok) {
        const savedBot = await response.json()
        console.log('Bot settings saved:', savedBot)
        // Update the bot in the allBots list
        setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? savedBot : bot))
        // Show embed code modal
        setShowEmbedModal(true)
        setEmbedCodeCopied(false)
      } else {
        const error = await response.json()
        console.error('Save error:', error)
      }
    } catch (error) {
      console.error('Save error:', error)
    }
  }

  const copyEmbedCode = (botId: string) => {
    const baseUrl = window.location.origin
    const bot = allBots.find(b => b.botId === botId) || selectedBot
    const webType = bot?.webType || 'web'
    const scriptFile = webType === 'web-advance' ? 'bot-advance.js' : 'bot.js'
    const embedCode = `<script src="${baseUrl}/${scriptFile}" data-bot="${botId}"></script>`
    navigator.clipboard.writeText(embedCode)
    setCopiedBotId(botId)
    setTimeout(() => setCopiedBotId(null), 2000)
  }

  const copyEmbedCodeModal = () => {
    if (selectedBot) {
      const baseUrl = window.location.origin
      const webType = selectedBot.webType || 'web'
      const scriptFile = webType === 'web-advance' ? 'bot-advance.js' : 'bot.js'
      const embedCode = `<script src="${baseUrl}/${scriptFile}" data-bot="${selectedBot.botId}"></script>`
      navigator.clipboard.writeText(embedCode)
      setEmbedCodeCopied(true)
      setTimeout(() => setEmbedCodeCopied(false), 3000)
    }
  }

  const getEmbedCode = (bot: BotSettings) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://chatai-seven-steel.vercel.app'
    const webType = bot?.webType || 'web'
    const scriptFile = webType === 'web-advance' ? 'bot-advance.js' : 'bot.js'
    return `<script src="${baseUrl}/${scriptFile}" data-bot="${bot.botId}"></script>`
  }

  // Document upload function
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBot || !event.target.files?.[0]) return

    const file = event.target.files[0]
    setUploadingFile(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('botId', selectedBot.botId)
      formData.append('category', 'General')
      formData.append('tags', '')

      const response = await fetch('/api/bot-settings/documents', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        setSelectedBot(prev => prev ? {
          ...prev,
          documents: [...(prev.documents || []), result.document]
        } : null)
        setSuccessMessage('Document uploaded successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Failed to upload document')
        setTimeout(() => setErrorMessage(''), 3000)
      }
    } catch (error) {
      setErrorMessage('Failed to upload document')
      setTimeout(() => setErrorMessage(''), 3000)
    } finally {
      setUploadingFile(false)
      event.target.value = ''
    }
  }

  // URL scraping function
  const handleUrlScraping = async () => {
    if (!selectedBot || !newUrl.trim()) return

    try {
      const response = await fetch('/api/bot-settings/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBot.botId,
          url: newUrl,
          category: newUrlCategory || 'General',
          tags: newUrlTags
        }),
      })

      if (response.ok) {
        const result = await response.json()
        setSelectedBot(prev => prev ? {
          ...prev,
          urls: [...(prev.urls || []), result.urlSource]
        } : null)
        setNewUrl('')
        setNewUrlCategory('')
        setNewUrlTags('')
        setSuccessMessage('URL content scraped successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Failed to scrape URL')
        setTimeout(() => setErrorMessage(''), 3000)
      }
    } catch (error) {
      setErrorMessage('Failed to scrape URL')
      setTimeout(() => setErrorMessage(''), 3000)
    }
  }

  // Structured data function
  const handleStructuredData = async () => {
    if (!selectedBot || !newStructuredName.trim() || !newStructuredData.trim()) return

    try {
      let parsedData
      try {
        parsedData = JSON.parse(newStructuredData)
      } catch {
        setErrorMessage('Invalid JSON format for structured data')
        setTimeout(() => setErrorMessage(''), 3000)
        return
      }

      const response = await fetch('/api/bot-settings/structured-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBot.botId,
          name: newStructuredName,
          type: newStructuredType,
          data: parsedData,
          category: newStructuredCategory || 'General',
          tags: newStructuredTags
        }),
      })

      if (response.ok) {
        const result = await response.json()
        setSelectedBot(prev => prev ? {
          ...prev,
          structuredData: [...(prev.structuredData || []), result.structuredData]
        } : null)
        setNewStructuredName('')
        setNewStructuredData('')
        setNewStructuredCategory('')
        setNewStructuredTags('')
        setSuccessMessage('Structured data added successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Failed to add structured data')
        setTimeout(() => setErrorMessage(''), 3000)
      }
    } catch (error) {
      setErrorMessage('Failed to add structured data')
      setTimeout(() => setErrorMessage(''), 3000)
    }
  }

  // Toggle enable/disable for data sources
  const toggleDataSource = async (type: 'documents' | 'urls' | 'structuredData', id: string, enabled: boolean) => {
    if (!selectedBot) return

    try {
      const endpoint = type === 'documents' ? 'documents' : type === 'urls' ? 'urls' : 'structured-data'
      const response = await fetch(`/api/bot-settings/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBot.botId,
          [type === 'documents' ? 'documentId' : type === 'urls' ? 'urlId' : 'dataId']: id,
          enabled
        }),
      })

      if (response.ok) {
        setSelectedBot(prev => prev ? {
          ...prev,
          [type]: prev[type]?.map(item => 
            item.id === id ? { ...item, enabled } : item
          ) || []
        } : null)
      }
    } catch (error) {
      console.error('Failed to toggle data source:', error)
    }
  }

  // Delete data source
  const deleteDataSource = async (type: 'documents' | 'urls' | 'structuredData', id: string) => {
    if (!selectedBot) return

    try {
      const endpoint = type === 'documents' ? 'documents' : type === 'urls' ? 'urls' : 'structured-data'
      const response = await fetch(`/api/bot-settings/${endpoint}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBot.botId,
          [type === 'documents' ? 'documentId' : type === 'urls' ? 'urlId' : 'dataId']: id
        }),
      })

      if (response.ok) {
        setSelectedBot(prev => prev ? {
          ...prev,
          [type]: prev[type]?.filter(item => item.id !== id) || []
        } : null)
        setSuccessMessage(`${type === 'documents' ? 'Document' : type === 'urls' ? 'URL' : 'Structured data'} deleted successfully!`)
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error) {
      setErrorMessage(`Failed to delete ${type === 'documents' ? 'document' : type === 'urls' ? 'URL' : 'structured data'}`)
      setTimeout(() => setErrorMessage(''), 3000)
    }
  }

  // Preview chat functions
  const openPreview = () => {
    setShowPreview(true)
    setPreviewMessages([{
      id: '1',
      text: selectedBot?.welcomeMessage || 'Xin chào anh chị! mình cần em tư vấn gì ạ?',
      isUser: false,
      timestamp: new Date()
    }])
  }

  const closePreview = () => {
    setShowPreview(false)
    setPreviewMessages([])
    setPreviewInput('')
  }

  const sendPreviewMessage = () => {
    if (!previewInput.trim() || !selectedBot) return

    const userMessage = {
      id: Date.now().toString(),
      text: previewInput,
      isUser: true,
      timestamp: new Date()
    }

    setPreviewMessages(prev => [...prev, userMessage])
    setPreviewInput('')

    // Simulate bot response
    setTimeout(() => {
      const botResponse = {
        id: (Date.now() + 1).toString(),
        text: "Đây là bản xem trước về cách Agent sẽ phản hồi. Trong quá trình triển khai thực tế, Sẽ sử dụng trí tuệ nhân tạo (AI) để tạo ra các phản hồi dựa trên các câu hỏi thường gặp và cài đặt.",
        isUser: false,
        timestamp: new Date()
      }
      setPreviewMessages(prev => [...prev, botResponse])
    }, 1000)
  }

  // Search functionality - now just updates the input
  const handleSearch = (query: string) => {
    setSearchInput(query)
  }

  // Pagination functions
  const goToPage = (page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, currentPage: page }))
      loadBots(page, searchQuery, sortBy, sortOrder)
    }
  }

  const changePageSize = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, currentPage: 1 }))
    loadBots(1, searchQuery, sortBy, sortOrder)
  }

  // Sort functionality
  const handleSort = (field: string) => {
    const newOrder = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc'
    setSortBy(field)
    setSortOrder(newOrder)
    setPagination(prev => ({ ...prev, currentPage: 1 }))
    loadBots(1, searchQuery, field, newOrder)
  }

  // Load more functionality
  const loadMoreBots = () => {
    setBotsToShow(prev => prev + 10)
  }

  // Telegram functions
  const handleGetTelegramBotInfo = async () => {
    if (!telegramToken.trim() || !selectedBot) return

    setTelegramLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/telegram/bot-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: telegramToken })
      })

      if (response.ok) {
        const botInfo = await response.json()
        setTelegramBotInfo(botInfo)
        setSuccessMessage('Đã lấy thông tin bot thành công!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể lấy thông tin bot')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setTelegramLoading(false)
    }
  }

  const handleSetTelegramWebhook = async () => {
    if (!telegramToken.trim() || !selectedBot) return

    setTelegramLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          botId: selectedBot.botId,
          token: telegramToken,
          webhookUrl: telegramWebhookUrl.trim() || undefined
        })
      })

      if (response.ok) {
        const result = await response.json()
        setTelegramBotInfo(result.botInfo)
        setSuccessMessage('Đã kích hoạt Telegram bot thành công!')
        
        // Use telegram settings from response if available
        if (result.telegram) {
          console.log('📥 Telegram settings from response:', result.telegram)
          setTelegramToken(result.telegram.botToken || telegramToken)
        }
        
        // Reload bot to get updated telegram settings
        const botResponse = await fetch(`/api/bot-settings?botId=${selectedBot.botId}`)
        if (botResponse.ok) {
          const updatedBot = await botResponse.json()
          console.log('📥 Updated bot from API:', updatedBot)
          console.log('📥 Telegram settings:', updatedBot.telegram)
          setSelectedBot(updatedBot)
          setTelegramToken(updatedBot.telegram?.botToken || telegramToken || result.telegram?.botToken || '')
          setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
          
          // Update displayed bots too
          setBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        }
        
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        let errorMsg = error.error || 'Không thể kích hoạt Telegram bot'
        
        // Add more details if available
        if (error.details) {
          if (typeof error.details === 'string') {
            errorMsg += `: ${error.details}`
          } else if (error.details.description) {
            errorMsg += `: ${error.details.description}`
          }
        }
        
        // Special handling for HTTPS requirement
        if (errorMsg.includes('HTTPS') || errorMsg.includes('https')) {
          errorMsg += '. Vui lòng sử dụng HTTPS hoặc ngrok cho local development.'
        }
        
        setErrorMessage(errorMsg)
        setTimeout(() => setErrorMessage(''), 8000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setTelegramLoading(false)
    }
  }

  const handleDeleteTelegramWebhook = async () => {
    if (!selectedBot) return

    setTelegramLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/telegram/delete-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: selectedBot.botId })
      })

      if (response.ok) {
        setSuccessMessage('Đã vô hiệu hóa Telegram bot thành công!')
        setTelegramToken('')
        setTelegramBotInfo(null)
        
        // Reload bot to get updated telegram settings
        const botResponse = await fetch(`/api/bot-settings?botId=${selectedBot.botId}`)
        if (botResponse.ok) {
          const updatedBot = await botResponse.json()
          setSelectedBot(updatedBot)
          setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        }
        
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể vô hiệu hóa Telegram bot')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setTelegramLoading(false)
    }
  }

  // Messenger functions
  const handleGetMessengerPageInfo = async () => {
    if (!messengerPageToken.trim() || !selectedBot) return

    setMessengerLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/messenger/page-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageAccessToken: messengerPageToken })
      })

      if (response.ok) {
        const pageInfo = await response.json()
        setMessengerPageInfo(pageInfo)
        setSuccessMessage('Đã lấy thông tin Page thành công!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể lấy thông tin Page')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setMessengerLoading(false)
    }
  }

  const handleSetMessengerWebhook = async () => {
    if (!messengerPageToken.trim() || !messengerVerifyToken.trim() || !selectedBot) return

    setMessengerLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/messenger/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          botId: selectedBot.botId,
          pageAccessToken: messengerPageToken,
          verifyToken: messengerVerifyToken,
          appSecret: messengerAppSecret.trim() || undefined,
          webhookUrl: messengerWebhookUrl.trim() || undefined
        })
      })

      if (response.ok) {
        const result = await response.json()
        setMessengerPageInfo(result.pageInfo)
        setSuccessMessage('Đã kích hoạt Messenger bot thành công!')
        
        if (result.instructions) {
          console.log('📋 Setup instructions:', result.instructions)
        }
        
        // Reload bot to get updated messenger settings
        const botResponse = await fetch(`/api/bot-settings?botId=${selectedBot.botId}`)
        if (botResponse.ok) {
          const updatedBot = await botResponse.json()
          setSelectedBot(updatedBot)
          setMessengerPageToken(updatedBot.messenger?.pageAccessToken || messengerPageToken)
          setMessengerVerifyToken(updatedBot.messenger?.verifyToken || messengerVerifyToken)
          setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
          setBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        }
        
        setTimeout(() => setSuccessMessage(''), 5000)
      } else {
        const error = await response.json()
        let errorMsg = error.error || 'Không thể kích hoạt Messenger bot'
        if (error.details) {
          if (typeof error.details === 'string') {
            errorMsg += `: ${error.details}`
          }
        }
        setErrorMessage(errorMsg)
        setTimeout(() => setErrorMessage(''), 8000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setMessengerLoading(false)
    }
  }

  const handleDeleteMessengerWebhook = async () => {
    if (!selectedBot) return

    setMessengerLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/messenger/delete-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: selectedBot.botId })
      })

      if (response.ok) {
        setSuccessMessage('Đã vô hiệu hóa Messenger bot thành công!')
        setMessengerPageToken('')
        setMessengerVerifyToken('')
        setMessengerPageInfo(null)
        
        // Reload bot to get updated messenger settings
        const botResponse = await fetch(`/api/bot-settings?botId=${selectedBot.botId}`)
        if (botResponse.ok) {
          const updatedBot = await botResponse.json()
          setSelectedBot(updatedBot)
          setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        }
        
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể vô hiệu hóa Messenger bot')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setMessengerLoading(false)
    }
  }

  // WhatsApp Web functions
  const handleGetWhatsAppQRCode = async () => {
    if (!selectedBot) return

    setWhatsappLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch(`/api/whatsapp-web/qr-code?botId=${selectedBot.botId}`)
      const data = await response.json()

      if (response.ok && data.qrCode) {
        setWhatsappQRCode(data.qrCode)
        setSuccessMessage('QR code đã được tạo! Quét QR code bằng WhatsApp để đăng nhập.')
        setTimeout(() => setSuccessMessage(''), 5000)
      } else if (data.authenticated) {
        setWhatsappStatus(data)
        setSuccessMessage('WhatsApp Web đã được kết nối!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        setErrorMessage(data.error || 'Không thể tạo QR code')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setWhatsappLoading(false)
    }
  }

  const handleGetWhatsAppStatus = async () => {
    if (!selectedBot) return

    setWhatsappLoading(true)
    setErrorMessage('')

    try {
      const response = await fetch(`/api/whatsapp-web/status?botId=${selectedBot.botId}`)
      const data = await response.json()

      if (response.ok) {
        setWhatsappStatus(data)
        if (data.authenticated) {
          setSuccessMessage('WhatsApp Web đã được kết nối!')
          setTimeout(() => setSuccessMessage(''), 3000)
        }
      } else {
        setErrorMessage(data.error || 'Không thể lấy trạng thái')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setWhatsappLoading(false)
    }
  }

  const handleEnableWhatsAppWeb = async () => {
    if (!selectedBot) return

    setWhatsappLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      // First, initialize client to get QR code
      await handleGetWhatsAppQRCode()
      
      // Then update bot settings to enable WhatsApp
      const response = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBot.botId,
          whatsapp: {
            enabled: true
          }
        })
      })

      if (response.ok) {
        const updatedBot = await response.json()
        setSelectedBot(updatedBot)
        setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        setSuccessMessage('WhatsApp Web bot đã được kích hoạt! Quét QR code để đăng nhập.')
        setTimeout(() => setSuccessMessage(''), 5000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể kích hoạt WhatsApp Web bot')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setWhatsappLoading(false)
    }
  }

  const handleDisableWhatsAppWeb = async () => {
    if (!selectedBot) return

    setWhatsappLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/api/whatsapp-web/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: selectedBot.botId })
      })

      if (response.ok) {
        // Also update bot settings
        const updateResponse = await fetch('/api/bot-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId: selectedBot.botId,
            whatsapp: {
              enabled: false
            }
          })
        })

        if (updateResponse.ok) {
          const updatedBot = await updateResponse.json()
          setSelectedBot(updatedBot)
          setAllBots(prev => prev.map(bot => bot.botId === selectedBot.botId ? updatedBot : bot))
        }

        setWhatsappQRCode(null)
        setWhatsappStatus(null)
        setSuccessMessage('Đã vô hiệu hóa WhatsApp Web bot thành công!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const error = await response.json()
        setErrorMessage(error.error || 'Không thể vô hiệu hóa WhatsApp Web bot')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      setErrorMessage('Lỗi kết nối. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setWhatsappLoading(false)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (status === 'unauthenticated') {
    return null
  }

  return (
    <div className="min-h-screen bg-[#1c1c1d] from-blue-50 to-indigo-100">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-[#1c1c1d] from-blue-50 via-indigo-50 to-purple-50"></div>
      <div className="absolute top-10 left-10 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse"></div>
      <div className="absolute top-20 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse animation-delay-2000"></div>
      <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse animation-delay-4000"></div>

      {/* Header */}
      <div className="relative bg-[#252728] backdrop-blur-sm shadow-lg border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Image 
                src="/images/logo-onfa-scaled.png" 
                alt="Logo" 
                width={150} 
                height={100} 
              />
                          </div>
            
            {/* Menu Items */}
            <div className="flex items-center space-x-3">
              {/* User Info */}
              <div className="hidden sm:block text-right mr-4">
                <p className="text-sm font-semibold text-white">{session?.user?.email}</p>
                <p className="text-xs text-gray-500">Administrator</p>
              </div>
              
              {/* Menu Items */}
              <Button
                onClick={() => router.push('/dashboard')}
                variant="outline"
                className={`flex items-center space-x-2 bg-[#333b47] backdrop-blur-sm text-white border-2 px-[12px] hover:bg-white/90 hover:border-b-indigo-300 shadow-lg relative ${
                  pathname === '/dashboard' 
                    ? 'border-[#333b47] border-b-2 border-b-indigo-500' 
                    : 'border-gray-200'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:block">All Agents</span>
              </Button>
              
              <Button
                onClick={() => router.push('/statistics')}
                variant="outline"
                className={`flex items-center space-x-2 bg-[#333b47] backdrop-blur-sm text-white border-2 px-[12px] hover:bg-white/90 hover:border-b-indigo-300 shadow-lg relative ${
                  pathname === '/statistics' 
                    ? 'border-[#333b47] border-b-2 border-b-indigo-500' 
                    : 'border-gray-200'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:block">Analytics</span>
              </Button>
              
              <Button
                onClick={() => router.push('/settings')}
                variant="outline"
                className={`flex items-center space-x-2 bg-[#333b47] backdrop-blur-sm text-white border-2 px-[12px] hover:bg-white/90 hover:border-b-indigo-300 shadow-lg relative ${
                  pathname === '/settings' 
                    ? 'border-[#333b47] border-b-2 border-b-indigo-500' 
                    : 'border-gray-200'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:block">Settings</span>
              </Button>
              
              <Button
                onClick={() => router.push('/profile')}
                variant="outline"
                className={`flex items-center space-x-2 bg-[#333b47] backdrop-blur-sm text-white border-2 px-[12px] hover:bg-white/90 hover:border-b-indigo-300 shadow-lg relative ${
                  pathname === '/profile' 
                    ? 'border-[#333b47] border-b-2 border-b-indigo-500' 
                    : 'border-gray-200'
                }`}
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:block">Profile</span>
              </Button>
              
              <Button
                onClick={() => signOut()}
                className="flex items-center space-x-2 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 shadow-lg"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:block">Sign Out</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Bots List */}
          <div className="lg:col-span-1">
            <Card className="shadow-sm bg-[#252728] rounded-md overflow-hidden border-[0]">
              <CardHeader className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <span className="text-lg">🤖</span>
                    </div>
                    <CardTitle className="text-xl font-bold text-white">Tất cả Agent</CardTitle>
                  </div>
                  <Button 
                    onClick={() => setShowCreateForm(!showCreateForm)}  
                    size="sm"
                    variant="outline"
                    className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Tạo thêm
                  </Button>
                </div>
                
                {/* Search Field Only */}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Tìm kiếm agent, tin nhắn..."
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      className="pl-10 border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Global Error Message */}
                {errorMessage && !showCreateForm && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-md">
                    <div className="flex items-center">
                      <div className="text-red-500 text-lg mr-2">⚠️</div>
                      {errorMessage}
                    </div>
                  </div>
                )}
                
                {/* Global Success Message */}
                {successMessage && !showCreateForm && (
                  <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-800 rounded-md">
                    <div className="flex items-center">
                      <div className="text-green-500 text-lg mr-2">✅</div>
                      {successMessage}
                    </div>
                  </div>
                )}
                
                {showCreateForm && (
                  <div className="mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg overflow-hidden shadow-sm">
                    <div className="bg-[#e1b038] text-white p-6">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center mr-3">
                          <Plus className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="text-xl font-bold">Tạo Bot Mới</h3>
                      </div>
                    </div>
                    <div className="p-6 space-y-6">
                      {/* Error Message */}
                      {errorMessage && (
                        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-md">
                          <div className="flex items-center">
                            <div className="text-red-500 text-lg mr-2">⚠️</div>
                            {errorMessage}
                          </div>
                        </div>
                      )}
                      
                      {/* Success Message */}
                      {successMessage && (
                        <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md">
                          <div className="flex items-center">
                            <div className="text-green-500 text-lg mr-2">✅</div>
                            {successMessage}
                          </div>
                        </div>
                      )}
                      
                      <div className="space-y-6">
                        <div>
                          <Label htmlFor="new-bot-id" className="text-sm font-semibold text-gray-700 mb-2 block">ID Agent</Label>
                          <Input
                            id="new-bot-id"
                            value={newBot.botId}
                            onChange={(e) => setNewBot({...newBot, botId: e.target.value})}
                            placeholder="ví dụ: thien_thanh_agent"
                            className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                          />
                          <p className="text-xs text-gray-500 mt-1">Phải là duy nhất. Chỉ sử dụng chữ thường, số và dấu gạch dưới.</p>
                        </div>
                        <div>
                          <Label htmlFor="new-bot-name" className="text-sm font-semibold text-gray-700 mb-2 block">Tên Agent</Label>
                          <Input
                            id="new-bot-name"
                            value={newBot.name}
                            onChange={(e) => setNewBot({...newBot, name: e.target.value})}
                            placeholder="ví dụ: Thiên Thanh"
                            className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="new-bot-welcome" className="text-sm font-semibold text-gray-700 mb-2 block">Tin nhắn chào mừng</Label>
                        <Input
                          id="new-bot-welcome"
                          value={newBot.welcomeMessage}
                          onChange={(e) => setNewBot({...newBot, welcomeMessage: e.target.value})}
                          placeholder="Nhập lời chào mừng cho bot của bạn"
                          className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                        />
                      </div>
                      <div>
                        <Label htmlFor="new-bot-color" className="text-sm font-semibold text-gray-700 mb-2 block">Màu giao diện</Label>
                        <div className="flex items-center space-x-3">
                          <Input
                            id="new-bot-color"
                            type="color"
                            value={newBot.themeColor}
                            onChange={(e) => setNewBot({...newBot, themeColor: e.target.value})}
                            className="w-16 h-12 border border-gray-200 rounded-md cursor-pointer"
                          />
                          <span className="text-sm text-gray-600">Chọn màu chủ đạo cho bot của bạn</span>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="new-bot-web-type" className="text-sm font-semibold text-gray-700 mb-2 block">Loại Chatbot Web</Label>
                        <select
                          id="new-bot-web-type"
                          value={newBot.webType}
                          onChange={(e) => setNewBot({...newBot, webType: e.target.value as 'web' | 'web-advance'})}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="web">Web (Modal Popup)</option>
                          <option value="web-advance">Web Advance (Sidebar)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {newBot.webType === 'web-advance' 
                            ? 'Sidebar popup từ bên phải với overlay (giống Binance)' 
                            : 'Modal popup ở góc dưới bên phải'}
                        </p>
                      </div>
                      <div className="flex space-x-3 pt-4 border-t border-gray-200">
                        <Button 
                          onClick={createBot} 
                          disabled={isCreatingBot}
                          size="sm"
                          className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-6 py-2 rounded-md shadow-lg transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                        >
                          {isCreatingBot ? (
                            <>
                              <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                              Đang tạo...
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Tạo Bot
                            </>
                          )}
                        </Button>
                        <Button 
                          onClick={() => setShowCreateForm(false)} 
                          variant="outline" 
                          size="sm"
                          className="border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 px-6 py-2 rounded-md transition-all duration-200"
                        >
                          Hủy
                        </Button>
                      </div>
                    </div>
                  </div>
                )}


                {/* Loading State */}
                {isLoading && (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <span className="ml-2 text-gray-600">Đang khởi tạo...</span>
                  </div>
                )}

                {/* Bots List */}
                <div className="space-y-3">
                  {!isLoading && bots.map((bot) => (
                    <div
                      key={bot.botId}
                        className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                          selectedBot?.botId === bot.botId 
                            ? 'bg-indigo-50 border-indigo-300 shadow-sm' 
                            : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-indigo-200 hover:shadow-sm'
                        }`}
                      onClick={() => selectBot(bot)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                              <span className="text-indigo-600 text-xs">🤖</span>
                            </div>
                            <h3 className="font-semibold text-gray-900">{bot.name}</h3>
                          </div>
                          <p className="text-xs text-gray-500 mb-1">ID: {bot.botId}</p>
                          <p className="text-xs text-gray-500">{bot.faqs.length} FAQs</p>
                        </div>
                        <div className="flex space-x-2">
                          <div className="relative">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                copyEmbedCode(bot.botId)
                              }}
                              className="w-8 h-8 p-0 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                            {copiedBotId === bot.botId && (
                              <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-indigo-500 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
                                Đã sao chép!
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              openDeleteModal(bot)
                            }}
                            className="w-8 h-8 p-0 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* No Results Message */}
                  {!isLoading && bots.length === 0 && (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Search className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-2">Không có Agent</h3>
                      <p className="text-gray-400">
                        {searchQuery ? 'Hãy thử điều chỉnh các từ khóa tìm kiếm của bạn.' : 'Hãy tạo Agent để bắt đầu.'}
                      </p>
                    </div>
                  )}

                  {/* Load More Button */}
                  {!isLoading && allBots.length > botsToShow && (
                    <div className="mt-6 text-center">
                      <Button
                        onClick={loadMoreBots}
                        variant="outline"
                        className="px-6 py-2 border border-indigo-300 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 transition-all duration-200"
                      >
                        Tải thêm Agent
                        <span className="ml-2 text-sm text-gray-500">
                          ({allBots.length - botsToShow} remaining)
                        </span>
                      </Button>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>
          </div>
          
          {/* Bot Settings */}
          <div className="lg:col-span-2">
            {selectedBot ? (
              <Card className="shadow-sm bg-white overflow-hidden border-[0] rounded-md">
                <CardHeader className="bg-[#252728] text-white p-6 border-[0]">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-bold text-white">Cấu hình: {selectedBot.name}</CardTitle>
                      <CardDescription className="text-purple-100">Mã Agent: {selectedBot.botId}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="bot-name" className="text-sm font-semibold text-gray-700 mb-2 block">Tên Agent</Label>
                      <Input
                        id="bot-name"
                        value={selectedBot.name}
                        onChange={(e) => setSelectedBot({...selectedBot, name: e.target.value})}
                        className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <Label htmlFor="bot-color" className="text-sm font-semibold text-gray-700 mb-2 block">Màu giao diện</Label>
                      <Input
                        id="bot-color"
                        type="color"
                        value={selectedBot.themeColor}
                        onChange={(e) => setSelectedBot({...selectedBot, themeColor: e.target.value})}
                        className="w-full h-12 border border-gray-200 rounded-md"
                      />
                    </div>
                    <div>
                      <Label htmlFor="web-type" className="text-sm font-semibold text-gray-700 mb-2 block">Loại Chatbot Web</Label>
                      <select
                        id="web-type"
                        value={selectedBot.webType || 'web'}
                        onChange={(e) => setSelectedBot({...selectedBot, webType: e.target.value as 'web' | 'web-advance'})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        <option value="web">Web (Modal Popup)</option>
                        <option value="web-advance">Web Advance (Sidebar)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        {selectedBot.webType === 'web-advance' 
                          ? 'Sidebar popup từ bên phải với overlay (giống Binance)' 
                          : 'Modal popup ở góc dưới bên phải'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="welcome-message" className="text-sm font-semibold text-gray-700 mb-2 block">Tin nhắn chào mừng</Label>
                    <Input
                      id="welcome-message"
                      value={selectedBot.welcomeMessage}
                      onChange={(e) => setSelectedBot({...selectedBot, welcomeMessage: e.target.value})}
                      className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  {/* Knowledge Base Tabs */}
                  <div className="space-y-6">
                    <div className="border-b border-gray-200 overflow-x-auto">
                      <nav className="-mb-px flex space-x-1 min-w-max">
                        {[
                          { id: 'faq', name: 'FAQs', fullName: 'Hỏi đáp (FAQs)', icon: MessageSquare },
                          { id: 'documents', name: 'Tài liệu', fullName: 'Tài liệu', icon: Upload },
                          { id: 'urls', name: 'Web', fullName: 'Nội dung Web', icon: Plus },
                          { id: 'structured', name: 'Dữ liệu', fullName: 'Dữ liệu cấu trúc', icon: BarChart3 },
                          { id: 'telegram', name: 'Telegram', fullName: 'Telegram Bot', icon: Send },
                          { id: 'messenger', name: 'Messenger', fullName: 'Messenger Bot', icon: MessageCircle },
                          { id: 'whatsapp', name: 'WhatsApp', fullName: 'WhatsApp Web Bot', icon: MessageSquare }
                        ].map((tab) => {
                          const Icon = tab.icon
                          return (
                            <button
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id as any)}
                              className={`py-3 px-4 border-b-2 font-medium text-sm flex items-center space-x-2 whitespace-nowrap transition-colors ${
                                activeTab === tab.id
                                  ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50'
                                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                              title={tab.fullName}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              <span className="hidden sm:inline">{tab.name}</span>
                              <span className="sm:hidden">{tab.name.length > 8 ? tab.name.substring(0, 8) + '...' : tab.name}</span>
                            </button>
                          )
                        })}
                      </nav>
                    </div>

                    {/* FAQ Tab */}
                    {activeTab === 'faq' && (
                      <div>
                        <Label htmlFor="faq-text" className="text-sm font-semibold text-gray-700 mb-2 block">Nội dung FAQ</Label>
                        <Textarea
                          id="faq-text"
                          value={faqText}
                          onChange={(e) => setFaqText(e.target.value)}
                          placeholder="Nhập các câu hỏi thường gặp theo định dạng Hỏi & Đáp, phân cách bằng hai lần xuống dòng..."
                          rows={10}
                          className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Định dạng: Q: Câu hỏi? A: Câu trả lời. Phân cách các cặp Q&A khác nhau bằng dòng trống.
                        </p>
                      </div>
                    )}

                    {/* Documents Tab */}
                    {activeTab === 'documents' && (
                      <div className="space-y-4">
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                          <div className="text-center">
                            <Upload className="mx-auto h-12 w-12 text-gray-400" />
                            <div className="mt-4">
                              <label htmlFor="file-upload" className="cursor-pointer">
                                <span className="mt-2 block text-sm font-medium text-gray-900">
                                  Tải lên tài liệu
                                </span>
                                <span className="mt-1 block text-sm text-gray-500">
                                  Các file PDF, DOCX, và TXT với khả năng trích xuất văn bản đầy đủ
                                </span>
                                <input
                                  id="file-upload"
                                  name="file-upload"
                                  type="file"
                                  accept=".pdf,.docx,.txt"
                                  onChange={handleFileUpload}
                                  disabled={uploadingFile}
                                  className="sr-only"
                                />
                              </label>
                              <Button
                                onClick={() => document.getElementById('file-upload')?.click()}
                                disabled={uploadingFile}
                                className="mt-4"
                              >
                                {uploadingFile ? 'Đang tải lên...' : 'Chọn tập tin'}
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Document List */}
                        {selectedBot.documents && selectedBot.documents.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-gray-900">Tài liệu đã tải lên</h4>
                            {selectedBot.documents.map((doc) => (
                              <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center space-x-3">
                                  <div className={`w-2 h-2 rounded-full ${doc.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                                  <span className="font-medium">{doc.name}</span>
                                  <span className="text-sm text-gray-500">({doc.type.toUpperCase()})</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => toggleDataSource('documents', doc.id, !doc.enabled)}
                                  >
                                    {doc.enabled ? 'Vô hiệu hóa' : 'Kích hoạt'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteDataSource('documents', doc.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* URLs Tab */}
                    {activeTab === 'urls' && (
                      <div className="space-y-4">
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="url-input" className="text-sm font-semibold text-gray-700 mb-2 block">URL Website</Label>
                            <Input
                              id="url-input"
                              value={newUrl}
                              onChange={(e) => setNewUrl(e.target.value)}
                              placeholder="https://example.com"
                              className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="url-category" className="text-sm font-semibold text-gray-700 mb-2 block">Danh mục</Label>
                              <Input
                                id="url-category"
                                value={newUrlCategory}
                                onChange={(e) => setNewUrlCategory(e.target.value)}
                                placeholder="Chung"
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <Label htmlFor="url-tags" className="text-sm font-semibold text-gray-700 mb-2 block">Thẻ (phân cách bằng dấu phẩy)</Label>
                              <Input
                                id="url-tags"
                                value={newUrlTags}
                                onChange={(e) => setNewUrlTags(e.target.value)}
                                placeholder="hotro, giupdo, faq"
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                          </div>
                          <Button onClick={handleUrlScraping} disabled={!newUrl.trim()}>
                            Thu thập nội dung
                          </Button>
                        </div>

                        {/* URL List */}
                        {selectedBot.urls && selectedBot.urls.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-gray-900">Các URL đã thu thập</h4>
                            {selectedBot.urls.map((url) => (
                              <div key={url.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-start space-x-3 flex-1 min-w-0">
                                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${url.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{url.title}</div>
                                    <div className="text-sm text-gray-500 break-all">{url.url}</div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0 ml-3">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => toggleDataSource('urls', url.id, !url.enabled)}
                                  >
                                    {url.enabled ? 'Vô hiệu hóa' : 'Kích hoạt'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteDataSource('urls', url.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Structured Data Tab */}
                    {activeTab === 'structured' && (
                      <div className="space-y-4">
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="structured-name" className="text-sm font-semibold text-gray-700 mb-2 block">Tên</Label>
                              <Input
                                id="structured-name"
                                value={newStructuredName}
                                onChange={(e) => setNewStructuredName(e.target.value)}
                                placeholder="Danh mục sản phẩm"
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <Label htmlFor="structured-type" className="text-sm font-semibold text-gray-700 mb-2 block">Loại</Label>
                              <select
                                id="structured-type"
                                value={newStructuredType}
                                onChange={(e) => setNewStructuredType(e.target.value as any)}
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full p-2"
                              >
                                <option value="products">Sản phẩm</option>
                                <option value="pricing">Bảng giá</option>
                                <option value="services">Dịch vụ</option>
                                <option value="catalog">Danh mục</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="structured-data" className="text-sm font-semibold text-gray-700 mb-2 block">Dữ liệu JSON</Label>
                            <Textarea
                              id="structured-data"
                              value={newStructuredData}
                              onChange={(e) => setNewStructuredData(e.target.value)}
                              placeholder='{"products": [{"name": "Sản phẩm 1", "price": 100, "description": "..."}]}'
                              rows={6}
                              className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="structured-category" className="text-sm font-semibold text-gray-700 mb-2 block">Danh mục</Label>
                              <Input
                                id="structured-category"
                                value={newStructuredCategory}
                                onChange={(e) => setNewStructuredCategory(e.target.value)}
                                placeholder="Chung"
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <Label htmlFor="structured-tags" className="text-sm font-semibold text-gray-700 mb-2 block">Thẻ (phân cách bằng dấu phẩy)</Label>
                              <Input
                                id="structured-tags"
                                value={newStructuredTags}
                                onChange={(e) => setNewStructuredTags(e.target.value)}
                                placeholder="sanpham, giaca, danhmuc"
                                className="border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                          </div>
                          <Button onClick={handleStructuredData} disabled={!newStructuredName.trim() || !newStructuredData.trim()}>
                            Thêm dữ liệu cấu trúc
                          </Button>
                        </div>

                        {/* Structured Data List */}
                        {selectedBot.structuredData && selectedBot.structuredData.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-gray-900">Nguồn dữ liệu cấu trúc</h4>
                            {selectedBot.structuredData.map((data) => (
                              <div key={data.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center space-x-3">
                                  <div className={`w-2 h-2 rounded-full ${data.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                                  <div>
                                    <div className="font-medium">{data.name}</div>
                                    <div className="text-sm text-gray-500 capitalize">{data.type}</div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => toggleDataSource('structuredData', data.id, !data.enabled)}
                                  >
                                    {data.enabled ? 'Vô hiệu hóa' : 'Kích hoạt'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteDataSource('structuredData', data.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Telegram Tab */}
                    {activeTab === 'telegram' && (
                      <div className="space-y-6">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <div className="flex items-start">
                            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center mr-3 mt-0.5">
                              <span className="text-white text-xs font-bold">i</span>
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-blue-900 mb-2">Hướng dẫn tích hợp Telegram Bot</h4>
                              <div className="text-sm text-blue-800 space-y-2">
                                <p><strong>1. Tạo bot trên Telegram:</strong> Nhắn tin cho <a href="https://t.me/botfather" target="_blank" rel="noopener noreferrer" className="underline">@BotFather</a> và gửi lệnh <code className="bg-blue-100 px-1 rounded">/newbot</code></p>
                                <p><strong>2. Nhận Bot Token:</strong> BotFather sẽ cung cấp token cho bạn (dạng: <code className="bg-blue-100 px-1 rounded">123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11</code>)</p>
                                <p><strong>3. Dán token vào ô bên dưới:</strong> Sau đó nhấn "Lấy thông tin bot" để xác minh</p>
                                <p><strong>4. Webhook URL:</strong> 
                                  {showCustomWebhook ? (
                                    <span> Nhập HTTPS URL (ví dụ từ ngrok: <code className="bg-blue-100 px-1 rounded">https://abc123.ngrok.io</code>)</span>
                                  ) : (
                                    <span> Hệ thống sẽ tự động sử dụng URL từ cấu hình. Nếu đang chạy localhost, <button onClick={() => setShowCustomWebhook(true)} className="underline font-medium">nhấn đây để nhập URL thủ công</button> (cần ngrok)</span>
                                  )}
                                </p>
                                <p><strong>5. Kích hoạt bot:</strong> Nhấn "Kích hoạt Telegram Bot" để bắt đầu sử dụng</p>
                                <p className="text-blue-600 font-medium">✨ Bot sẽ tự động trả lời tin nhắn dựa trên FAQs và knowledge base của bạn!</p>
                                {errorMessage && errorMessage.includes('HTTPS') && (
                                  <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                                    <p className="text-yellow-800 font-medium">⚠️ Lưu ý: Telegram yêu cầu HTTPS!</p>
                                    <p className="text-yellow-700 text-xs mt-1">Nếu đang chạy localhost, bạn cần:</p>
                                    <ol className="text-yellow-700 text-xs mt-1 ml-4 list-decimal">
                                      <li>Cài đặt ngrok: <code className="bg-yellow-100 px-1">npm install -g ngrok</code></li>
                                      <li>Chạy: <code className="bg-yellow-100 px-1">ngrok http 3000</code></li>
                                      <li>Copy URL HTTPS từ ngrok và nhập vào ô Webhook URL bên dưới</li>
                                    </ol>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Error/Success Messages */}
                        {errorMessage && (
                          <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-red-500 text-lg mr-2">⚠️</div>
                              {errorMessage}
                            </div>
                          </div>
                        )}
                        
                        {successMessage && (
                          <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-green-500 text-lg mr-2">✅</div>
                              {successMessage}
                            </div>
                          </div>
                        )}

                          {/* Telegram Bot Token Input */}
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="telegram-token" className="text-sm font-semibold text-gray-700 mb-2 block">
                              Telegram Bot Token
                            </Label>
                            <div className="flex space-x-2">
                              <Input
                                id="telegram-token"
                                type="password"
                                value={telegramToken}
                                onChange={(e) => setTelegramToken(e.target.value)}
                                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                                className="flex-1 border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                                disabled={selectedBot?.telegram?.enabled}
                              />
                              {!selectedBot?.telegram?.enabled && (
                                <Button
                                  onClick={handleGetTelegramBotInfo}
                                  disabled={!telegramToken.trim() || telegramLoading}
                                  variant="outline"
                                >
                                  {telegramLoading ? 'Đang kiểm tra...' : 'Lấy thông tin bot'}
                                </Button>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              Token được lưu trữ an toàn và chỉ dùng để kết nối với Telegram API
                            </p>
                          </div>

                          {/* Custom Webhook URL Input */}
                          {(showCustomWebhook || errorMessage?.includes('HTTPS')) && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <Label htmlFor="telegram-webhook-url" className="text-sm font-semibold text-gray-700">
                                  Webhook URL (HTTPS) - Tùy chọn
                                </Label>
                                {!errorMessage?.includes('HTTPS') && (
                                  <button
                                    onClick={() => {
                                      setShowCustomWebhook(false)
                                      setTelegramWebhookUrl('')
                                    }}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                  >
                                    Dùng URL mặc định
                                  </button>
                                )}
                              </div>
                              <Input
                                id="telegram-webhook-url"
                                type="url"
                                value={telegramWebhookUrl}
                                onChange={(e) => setTelegramWebhookUrl(e.target.value)}
                                placeholder="https://abc123.ngrok.io hoặc https://yourdomain.com"
                                className="w-full border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                                disabled={selectedBot?.telegram?.enabled}
                              />
                              <p className="mt-1 text-xs text-gray-500">
                                {errorMessage?.includes('HTTPS') 
                                  ? '⚠️ Bắt buộc phải là HTTPS. Nếu đang chạy localhost, dùng ngrok để tạo HTTPS URL.'
                                  : 'Để trống để dùng URL tự động từ cấu hình. Nhập URL HTTPS nếu đang dùng ngrok hoặc custom domain.'}
                              </p>
                            </div>
                          )}

                          {/* Bot Info Display */}
                          {telegramBotInfo && (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <h4 className="font-medium text-gray-900 mb-3">Thông tin Bot</h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Tên bot:</span>
                                  <span className="font-medium">{telegramBotInfo.firstName}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Username:</span>
                                  <span className="font-medium">@{telegramBotInfo.username}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Bot ID:</span>
                                  <span className="font-medium">{telegramBotInfo.id}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Current Status */}
                          {selectedBot?.telegram?.enabled && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h4 className="font-medium text-green-900 mb-1">✅ Telegram Bot đã được kích hoạt</h4>
                                  <p className="text-sm text-green-700">
                                    Bot username: <strong>@{selectedBot.telegram.botUsername}</strong>
                                  </p>
                                  {selectedBot.telegram.webhookUrl && (
                                    <p className="text-xs text-green-600 mt-1">
                                      Webhook: {selectedBot.telegram.webhookUrl}
                                    </p>
                                  )}
                                </div>
                                <Button
                                  onClick={handleDeleteTelegramWebhook}
                                  disabled={telegramLoading}
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  {telegramLoading ? 'Đang xử lý...' : 'Vô hiệu hóa'}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Activate Button */}
                          {!selectedBot?.telegram?.enabled && telegramToken && (
                            <Button
                              onClick={handleSetTelegramWebhook}
                              disabled={!telegramToken.trim() || telegramLoading || !telegramBotInfo}
                              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                            >
                              {telegramLoading ? (
                                <>
                                  <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                  Đang kích hoạt...
                                </>
                              ) : (
                                <>
                                  <Send className="w-4 h-4 mr-2" />
                                  Kích hoạt Telegram Bot
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Messenger Tab */}
                    {activeTab === 'messenger' && (
                      <div className="space-y-6">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <div className="flex items-start">
                            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center mr-3 mt-0.5">
                              <span className="text-white text-xs font-bold">i</span>
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-blue-900 mb-2">Hướng dẫn tích hợp Facebook Messenger Bot</h4>
                              <div className="text-sm text-blue-800 space-y-2">
                                <p><strong>1. Tạo Facebook App:</strong> Vào <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="underline">Facebook Developers</a> và tạo App mới</p>
                                <p><strong>2. Thêm Messenger Product:</strong> Trong App Dashboard, thêm sản phẩm "Messenger"</p>
                                <p><strong>3. Tạo Page Access Token:</strong> 
                                  <ul className="ml-4 mt-1 list-disc">
                                    <li>Vào Messenger → Settings</li>
                                    <li>Chọn Facebook Page của bạn</li>
                                    <li>Copy "Page Access Token"</li>
                                  </ul>
                                </p>
                                <p><strong>4. Tạo Verify Token:</strong> Tạo một token bất kỳ (ví dụ: <code className="bg-blue-100 px-1 rounded">my_verify_token_123</code>) để xác minh webhook</p>
                                <p><strong>5. App Secret (Tùy chọn):</strong> Copy App Secret từ App Settings → Basic để bảo mật webhook</p>
                                <p><strong>6. Nhập thông tin vào các ô bên dưới:</strong> Sau đó nhấn "Lấy thông tin Page" để xác minh</p>
                                <p><strong>7. Webhook URL:</strong> 
                                  {showMessengerCustomWebhook ? (
                                    <span> Nhập HTTPS URL (ví dụ từ ngrok: <code className="bg-blue-100 px-1 rounded">https://abc123.ngrok.io</code>)</span>
                                  ) : (
                                    <span> Hệ thống sẽ tự động sử dụng URL từ cấu hình. Nếu đang chạy localhost, <button onClick={() => setShowMessengerCustomWebhook(true)} className="underline font-medium">nhấn đây để nhập URL thủ công</button> (cần ngrok)</span>
                                  )}
                                </p>
                                <p><strong>8. Kích hoạt bot:</strong> Nhấn "Kích hoạt Messenger Bot" và làm theo hướng dẫn để cấu hình webhook trong Facebook App Dashboard</p>
                                <p className="text-blue-600 font-medium">✨ Bot sẽ tự động trả lời tin nhắn dựa trên FAQs và knowledge base của bạn!</p>
                                {errorMessage && errorMessage.includes('HTTPS') && (
                                  <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                                    <p className="text-yellow-800 font-medium">⚠️ Lưu ý: Messenger yêu cầu HTTPS!</p>
                                    <p className="text-yellow-700 text-xs mt-1">Nếu đang chạy localhost, bạn cần:</p>
                                    <ol className="text-yellow-700 text-xs mt-1 ml-4 list-decimal">
                                      <li>Cài đặt ngrok: <code className="bg-yellow-100 px-1">npm install -g ngrok</code></li>
                                      <li>Chạy: <code className="bg-yellow-100 px-1">ngrok http 3000</code></li>
                                      <li>Copy URL HTTPS từ ngrok và nhập vào ô Webhook URL bên dưới</li>
                                    </ol>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Error/Success Messages */}
                        {errorMessage && (
                          <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-red-500 text-lg mr-2">⚠️</div>
                              {errorMessage}
                            </div>
                          </div>
                        )}
                        
                        {successMessage && (
                          <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-green-500 text-lg mr-2">✅</div>
                              {successMessage}
                            </div>
                          </div>
                        )}

                        {/* Messenger Page Access Token Input */}
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="messenger-page-token" className="text-sm font-semibold text-gray-700 mb-2 block">
                              Page Access Token
                            </Label>
                            <div className="flex space-x-2">
                              <Input
                                id="messenger-page-token"
                                type="password"
                                value={messengerPageToken}
                                onChange={(e) => setMessengerPageToken(e.target.value)}
                                placeholder="EAAxxxxxxxxxxxxx"
                                className="flex-1 border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                                disabled={selectedBot?.messenger?.enabled}
                              />
                              {!selectedBot?.messenger?.enabled && (
                                <Button
                                  onClick={handleGetMessengerPageInfo}
                                  disabled={!messengerPageToken.trim() || messengerLoading}
                                  variant="outline"
                                >
                                  {messengerLoading ? 'Đang kiểm tra...' : 'Lấy thông tin Page'}
                                </Button>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              Token được lưu trữ an toàn và chỉ dùng để kết nối với Facebook Messenger API
                            </p>
                          </div>

                          <div>
                            <Label htmlFor="messenger-verify-token" className="text-sm font-semibold text-gray-700 mb-2 block">
                              Verify Token
                            </Label>
                            <Input
                              id="messenger-verify-token"
                              type="text"
                              value={messengerVerifyToken}
                              onChange={(e) => setMessengerVerifyToken(e.target.value)}
                              placeholder="my_verify_token_123"
                              className="w-full border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                              disabled={selectedBot?.messenger?.enabled}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              Token này sẽ được dùng để xác minh webhook với Facebook
                            </p>
                          </div>

                          <div>
                            <Label htmlFor="messenger-app-secret" className="text-sm font-semibold text-gray-700 mb-2 block">
                              App Secret (Tùy chọn - Khuyến nghị cho bảo mật)
                            </Label>
                            <Input
                              id="messenger-app-secret"
                              type="password"
                              value={messengerAppSecret}
                              onChange={(e) => setMessengerAppSecret(e.target.value)}
                              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                              className="w-full border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                              disabled={selectedBot?.messenger?.enabled}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              App Secret giúp xác minh tính hợp lệ của webhook requests từ Facebook
                            </p>
                          </div>

                          {/* Custom Webhook URL Input */}
                          {(showMessengerCustomWebhook || errorMessage?.includes('HTTPS')) && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <Label htmlFor="messenger-webhook-url" className="text-sm font-semibold text-gray-700">
                                  Webhook URL (HTTPS) - Tùy chọn
                                </Label>
                                {!errorMessage?.includes('HTTPS') && (
                                  <button
                                    onClick={() => {
                                      setShowMessengerCustomWebhook(false)
                                      setMessengerWebhookUrl('')
                                    }}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                  >
                                    Dùng URL mặc định
                                  </button>
                                )}
                              </div>
                              <Input
                                id="messenger-webhook-url"
                                type="url"
                                value={messengerWebhookUrl}
                                onChange={(e) => setMessengerWebhookUrl(e.target.value)}
                                placeholder="https://abc123.ngrok.io hoặc https://yourdomain.com"
                                className="w-full border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                                disabled={selectedBot?.messenger?.enabled}
                              />
                              <p className="mt-1 text-xs text-gray-500">
                                {errorMessage?.includes('HTTPS') 
                                  ? '⚠️ Bắt buộc phải là HTTPS. Nếu đang chạy localhost, dùng ngrok để tạo HTTPS URL.'
                                  : 'Để trống để dùng URL tự động từ cấu hình. Nhập URL HTTPS nếu đang dùng ngrok hoặc custom domain.'}
                              </p>
                            </div>
                          )}

                          {/* Page Info Display */}
                          {messengerPageInfo && (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <h4 className="font-medium text-gray-900 mb-3">Thông tin Page</h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Tên Page:</span>
                                  <span className="font-medium">{messengerPageInfo.name}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Page ID:</span>
                                  <span className="font-medium">{messengerPageInfo.id}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Current Status */}
                          {selectedBot?.messenger?.enabled && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h4 className="font-medium text-green-900 mb-1">✅ Messenger Bot đã được kích hoạt</h4>
                                  <p className="text-sm text-green-700">
                                    Page: <strong>{selectedBot.messenger.pageName}</strong>
                                  </p>
                                  {selectedBot.messenger.webhookUrl && (
                                    <p className="text-xs text-green-600 mt-1">
                                      Webhook: {selectedBot.messenger.webhookUrl}
                                    </p>
                                  )}
                                  <p className="text-xs text-green-600 mt-2">
                                    ⚠️ Nhớ cấu hình webhook trong Facebook App Dashboard với Verify Token: <strong>{selectedBot.messenger.verifyToken}</strong>
                                  </p>
                                </div>
                                <Button
                                  onClick={handleDeleteMessengerWebhook}
                                  disabled={messengerLoading}
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  {messengerLoading ? 'Đang xử lý...' : 'Vô hiệu hóa'}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Activate Button */}
                          {!selectedBot?.messenger?.enabled && messengerPageToken && messengerVerifyToken && (
                            <Button
                              onClick={handleSetMessengerWebhook}
                              disabled={!messengerPageToken.trim() || !messengerVerifyToken.trim() || messengerLoading || !messengerPageInfo}
                              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                            >
                              {messengerLoading ? (
                                <>
                                  <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                  Đang kích hoạt...
                                </>
                              ) : (
                                <>
                                  <MessageCircle className="w-4 h-4 mr-2" />
                                  Kích hoạt Messenger Bot
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* WhatsApp Web Tab */}
                    {activeTab === 'whatsapp' && (
                      <div className="space-y-6">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <div className="flex items-start">
                            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mr-3 mt-0.5">
                              <span className="text-white text-xs font-bold">i</span>
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-green-900 mb-2">Hướng dẫn tích hợp WhatsApp Web Bot</h4>
                              <div className="text-sm text-green-800 space-y-2">
                                <p><strong>1. Kích hoạt WhatsApp Web Bot:</strong> Nhấn nút "Kích hoạt WhatsApp Web Bot" bên dưới</p>
                                <p><strong>2. Quét QR Code:</strong> Sau khi kích hoạt, QR code sẽ hiển thị. Mở WhatsApp trên điện thoại → Settings → Linked Devices → Link a Device</p>
                                <p><strong>3. Quét QR Code:</strong> Quét QR code trên màn hình để đăng nhập</p>
                                <p><strong>4. Đợi xác thực:</strong> Sau khi quét, đợi vài giây để hệ thống xác thực</p>
                                <p><strong>5. Kiểm tra trạng thái:</strong> Nhấn "Kiểm tra trạng thái" để xem bot đã kết nối chưa</p>
                                <p className="text-green-600 font-medium">✨ Bot sẽ tự động trả lời tin nhắn dựa trên FAQs và knowledge base của bạn!</p>
                                <p className="text-yellow-700 font-medium">⚠️ Lưu ý: Giải pháp này sử dụng WhatsApp Web.js (không chính thức). Chỉ nên dùng cho testing/personal use.</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Error/Success Messages */}
                        {errorMessage && (
                          <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-red-500 text-lg mr-2">⚠️</div>
                              {errorMessage}
                            </div>
                          </div>
                        )}
                        
                        {successMessage && (
                          <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-md">
                            <div className="flex items-center">
                              <div className="text-green-500 text-lg mr-2">✅</div>
                              {successMessage}
                            </div>
                          </div>
                        )}

                        {/* QR Code Display */}
                        {whatsappQRCode && (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                            <h4 className="font-medium text-gray-900 mb-4">QR Code để đăng nhập WhatsApp Web</h4>
                            <div className="flex justify-center mb-4">
                              <img src={whatsappQRCode} alt="WhatsApp QR Code" className="max-w-xs border-2 border-gray-300 rounded-lg" />
                            </div>
                            <p className="text-sm text-gray-600 text-center">
                              Quét QR code này bằng WhatsApp trên điện thoại để đăng nhập
                            </p>
                          </div>
                        )}

                        {/* Status Display */}
                        {whatsappStatus && whatsappStatus.authenticated && (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-medium text-green-900 mb-1">✅ WhatsApp Web đã được kết nối</h4>
                                <p className="text-sm text-green-700">
                                  Số điện thoại: <strong>{whatsappStatus.phoneNumber}</strong>
                                </p>
                                {whatsappStatus.name && (
                                  <p className="text-sm text-green-700">
                                    Tên: <strong>{whatsappStatus.name}</strong>
                                  </p>
                                )}
                              </div>
                              <Button
                                onClick={handleDisableWhatsAppWeb}
                                disabled={whatsappLoading}
                                variant="outline"
                                className="text-red-600 border-red-200 hover:bg-red-50"
                              >
                                {whatsappLoading ? 'Đang xử lý...' : 'Vô hiệu hóa'}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Current Status */}
                        {selectedBot?.whatsapp?.enabled && !whatsappStatus && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-medium text-yellow-900 mb-1">⚠️ WhatsApp Web Bot đã được kích hoạt</h4>
                                <p className="text-sm text-yellow-700">
                                  Nhấn "Kiểm tra trạng thái" để xem trạng thái kết nối hiện tại
                                </p>
                              </div>
                              <Button
                                onClick={handleDisableWhatsAppWeb}
                                disabled={whatsappLoading}
                                variant="outline"
                                className="text-red-600 border-red-200 hover:bg-red-50"
                              >
                                {whatsappLoading ? 'Đang xử lý...' : 'Vô hiệu hóa'}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="space-y-3">
                          {!selectedBot?.whatsapp?.enabled && (
                            <Button
                              onClick={handleEnableWhatsAppWeb}
                              disabled={whatsappLoading}
                              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
                            >
                              {whatsappLoading ? (
                                <>
                                  <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                  Đang kích hoạt...
                                </>
                              ) : (
                                <>
                                  <MessageSquare className="w-4 h-4 mr-2" />
                                  Kích hoạt WhatsApp Web Bot
                                </>
                              )}
                            </Button>
                          )}

                          {(selectedBot?.whatsapp?.enabled || whatsappQRCode) && (
                            <>
                              <Button
                                onClick={handleGetWhatsAppQRCode}
                                disabled={whatsappLoading}
                                variant="outline"
                                className="w-full"
                              >
                                {whatsappLoading ? 'Đang tải...' : 'Lấy QR Code'}
                              </Button>
                              <Button
                                onClick={handleGetWhatsAppStatus}
                                disabled={whatsappLoading}
                                variant="outline"
                                className="w-full"
                              >
                                {whatsappLoading ? 'Đang kiểm tra...' : 'Kiểm tra trạng thái'}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between">
                    <Button 
                      onClick={openPreview}
                      variant="outline"
                      className="flex items-center space-x-2 border border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-6 py-3 rounded-md shadow-lg transform hover:scale-105 transition-all duration-300"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Xem trước Chat</span>
                    </Button>
                    
                    <Button 
                      onClick={handleSaveSettings} 
                      className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-8 py-3 rounded-md shadow-lg transform hover:scale-105 transition-all duration-300"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Lưu cài đặt
                    </Button>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold text-gray-700 mb-2 block">Mã nhúng</Label>
                    <div className="flex space-x-3">
                      <Input
                        value={getEmbedCode(selectedBot)}
                        readOnly
                        className="font-mono text-sm border border-gray-200 rounded-md bg-gray-50"
                      />
                      <div className="relative">
                        <Button 
                          onClick={() => copyEmbedCode(selectedBot.botId)}
                          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white px-4 py-2 rounded-md shadow-lg transform hover:scale-105 transition-all duration-300"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        {copiedBotId === selectedBot.botId && (
                          <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-indigo-500 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
                            Đã sao chép!
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="flex items-start">
                        <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center mr-3 mt-0.5">
                          <span className="text-white text-xs font-bold">i</span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-blue-900 mb-2">Cách nhúng mã này</h4>
                          <div className="text-sm text-blue-800 space-y-2">
                            <p><strong>1. Sao chép mã ở trên</strong> bằng cách sử dụng nút copy</p>
                            <p><strong>2. Dán mã vào chân trang (footer)</strong> website của bạn</p>
                            <p><strong>3. Widget chat sẽ tự động xuất hiện</strong> trên website của bạn</p>
                            <p className="text-blue-600 font-medium">✨ Hoạt động với mọi website: WordPress, Shopify, HTML, React, Vue, Angular, v.v.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {analytics && (
                    <div className="bg-gradient-to-r from-gray-50 to-indigo-50 p-6 rounded-lg border border-gray-200">
                      <div className="flex items-center mb-6">
                        <div className="w-8 h-8 bg-[#1c1c1d] from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center mr-3">
                          <BarChart3 className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">Thống kê</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-md border border-blue-200">
                          <div className="flex items-center">
                            <MessageCircle className="w-6 h-6 text-blue-600 mr-3" />
                            <div>
                              <p className="text-2xl font-bold text-blue-600">{analytics.stats?.messagesSent || 0}</p>
                              <p className="text-sm text-gray-600 font-medium">Tin nhắn</p>
                            </div>
                          </div>
                        </div>
                        <div className="bg-gradient-to-r from-green-50 to-green-100 p-4 rounded-md border border-green-200">
                          <div className="flex items-center">
                            <Users className="w-6 h-6 text-green-600 mr-3" />
                            <div>
                              <p className="text-2xl font-bold text-green-600">{analytics.stats?.chatOpens || 0}</p>
                              <p className="text-sm text-gray-600 font-medium">Lượt mở chat</p>
                            </div>
                          </div>
                        </div>
                        <div className="bg-gradient-to-r from-purple-50 to-purple-100 p-4 rounded-md border border-purple-200">
                          <div className="flex items-center">
                            <BarChart3 className="w-6 h-6 text-purple-600 mr-3" />
                            <div>
                              <p className="text-2xl font-bold text-purple-600">{analytics.stats?.totalInteractions || 0}</p>
                              <p className="text-sm text-gray-600 font-medium">Tương tác</p>
                            </div>
                          </div>
                        </div>
                        <div className="bg-gradient-to-r from-orange-50 to-orange-100 p-4 rounded-md border border-orange-200">
                          <div className="flex items-center">
                            <Clock className="w-6 h-6 text-orange-600 mr-3" />
                            <div>
                              <p className="text-2xl font-bold text-orange-600">{analytics.stats?.uniqueSessions || 0}</p>
                              <p className="text-sm text-gray-600 font-medium">Phiên</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-2xl bg-[#252728] backdrop-blur-sm border-0 rounded-md overflow-hidden">
                <CardContent className="text-center py-16">
                  <div className="w-20 h-20 bg-[#1c1c1d] from-gray-200 to-gray-300 rounded-full flex items-center justify-center mx-auto mb-6">
                    <MessageSquare className="w-10 h-10 text-gray-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">Không có Agent được chọn</h3>
                  <p className="text-gray-400 text-lg">Chọn một Agent từ danh sách để xem và chỉnh sửa cài đặt của nó.</p>
                </CardContent>
              </Card>
            )}
          </div>
         
        </div>
      </div>

      {/* Preview Chat Modal */}
      {showPreview && selectedBot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full h-[600px] flex flex-col">
            {/* Chat Header */}
            <div 
              className="p-4 rounded-t-lg text-white flex items-center justify-between"
              style={{ backgroundColor: selectedBot.themeColor }}
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold">{selectedBot.name}</h3>
                  <p className="text-sm opacity-90">Xem trước</p>
                </div>
              </div>
              <Button
                onClick={closePreview}
                variant="outline"
                size="sm"
                className="w-8 h-8 p-0 bg-white/20 border-white/30 text-white hover:bg-white/30"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {previewMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-4 py-2 rounded-lg ${
                      message.isUser
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-900'
                    }`}
                  >
                    <p className="text-sm">{message.text}</p>
                    <p className={`text-xs mt-1 ${
                      message.isUser ? 'text-indigo-100' : 'text-gray-500'
                    }`}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-gray-200 bg-white">
              <div className="flex space-x-2">
                <Input
                  value={previewInput}
                  onChange={(e) => setPreviewInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendPreviewMessage()}
                  placeholder="Nhập và gửi tin nhắn..."
                  className="flex-1"
                />
                <Button
                  onClick={sendPreviewMessage}
                  disabled={!previewInput.trim()}
                  className="px-4 py-2"
                  style={{ backgroundColor: selectedBot.themeColor }}
                >
                  Send
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Đây chỉ là bản xem trước. Thực tế sẽ sử dụng trí tuệ nhân tạo để trả lời dựa trên các câu hỏi thường gặp của bạn.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Embed Code Modal */}
      {showEmbedModal && selectedBot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-[#1c1c1d] from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Đã lưu cài đặt thành công!</h3>
                  <p className="text-sm text-gray-600">Sao chép mã nhúng để thêm Agent này vào website của bạn</p>
                </div>
              </div>
              <Button
                onClick={() => setShowEmbedModal(false)}
                variant="outline"
                size="sm"
                className="w-8 h-8 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Thông tin Agent</Label>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Tên Agent:</span>
                    <span className="text-sm font-medium text-gray-900">{selectedBot.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">ID Agent:</span>
                    <span className="text-sm font-medium text-gray-900">{selectedBot.botId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Màu giao diện:</span>
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-4 h-4 rounded border border-gray-300" 
                        style={{ backgroundColor: selectedBot.themeColor }}
                      ></div>
                      <span className="text-sm font-medium text-gray-900">{selectedBot.themeColor}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Mã nhúng</Label>
                <div className="flex space-x-3">
                  <Input
                    value={getEmbedCode(selectedBot)}
                    readOnly
                    className="font-mono text-sm border border-gray-200 rounded-md bg-gray-50"
                  />
                  <div className="relative">
                    <Button 
                      onClick={copyEmbedCodeModal}
                      className={`px-4 py-2 rounded-md shadow-lg transform hover:scale-105 transition-all duration-300 ${
                        embedCodeCopied 
                          ? 'bg-green-600 hover:bg-green-700 text-white' 
                          : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                      }`}
                    >
                      {embedCodeCopied ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Đã sao chép!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Sao chép mã
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center mr-3 mt-0.5">
                    <span className="text-white text-xs font-bold">i</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-blue-900 mb-2">Cách sử dụng mã này</h4>
                    <div className="text-sm text-blue-800 space-y-2">
                      <p><strong>1. Sao chép mã ở trên</strong> bằng cách sử dụng nút sao chép</p>
                      <p><strong>2. Dán vào HTML website của bạn</strong> (tốt nhất là trước thẻ đóng &lt;/body&gt;)</p>
                      <p><strong>3. Widget chat sẽ tự động xuất hiện</strong> trên website của bạn</p>
                      <p className="text-blue-600 font-medium">✨ Hoạt động với mọi website: WordPress, Shopify, HTML, React, Vue, Angular, v.v.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <Button
                  onClick={() => setShowEmbedModal(false)}
                  variant="outline"
                  className="px-6 py-2"
                >
                  Đóng
                </Button>
                <Button
                  onClick={copyEmbedCodeModal}
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-6 py-2"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Sao chép mã nhúng
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && botToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Xóa Agent</h3>
                  <p className="text-sm text-gray-600">Hành động này không thể hoàn tác</p>
                </div>
              </div>
              <Button
                onClick={cancelDeleteBot}
                variant="outline"
                size="sm"
                className="w-8 h-8 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="p-6">
              <div className="mb-6">
                <p className="text-gray-700 mb-4">
                  Bạn có chắc chắn muốn xóa <strong>"{botToDelete.name}"</strong> không?
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <span className="text-red-500 text-lg">⚠️</span>
                    </div>
                    <div className="ml-3">
                      <h4 className="text-sm font-semibold text-red-800 mb-1">Cảnh báo</h4>
                      <p className="text-sm text-red-700">
                        Việc này sẽ xóa vĩnh viễn Agent và tất cả dữ liệu của nó. Bất kỳ website nào đang sử dụng Agent này sẽ ngừng hoạt động.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  onClick={cancelDeleteBot}
                  variant="outline"
                  className="px-6 py-2"
                >
                  Hủy
                </Button>
                <Button
                  onClick={confirmDeleteBot}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-2"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Xóa Agent
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}