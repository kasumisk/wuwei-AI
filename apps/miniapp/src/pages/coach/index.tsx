import React, { useState, useRef, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Input, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import * as coachService from '@/services/coach'
import type { CoachMessage, CoachConversation, DailyGreeting } from '@/types/api'
import './index.scss'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const quickQuestions = [
  '今天吃什么比较健康？',
  '帮我分析一下今天的饮食',
  '如何减少碳水摄入？',
  '推荐一些高蛋白食物',
]

function CoachPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [greeting, setGreeting] = useState<DailyGreeting | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [conversations, setConversations] = useState<CoachConversation[]>([])
  const scrollId = useRef('msg-bottom')

  useDidShow(() => { loadGreeting() })

  const loadGreeting = async () => {
    try { const g = await coachService.getDailyGreeting(); setGreeting(g) } catch {}
  }

  const scrollToBottom = useCallback(() => {
    scrollId.current = 'msg-bottom-' + Date.now()
  }, [])

  const handleSend = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || sending) return
    setInput('')
    const userMsg: ChatMsg = { id: 'u-' + Date.now(), role: 'user', content: msg }
    const assistantMsg: ChatMsg = { id: 'a-' + Date.now(), role: 'assistant', content: '', streaming: true }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setSending(true)
    scrollToBottom()
    try {
      coachService.sendMessageStream(msg, conversationId,
        (fullText) => { setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m)); scrollToBottom() },
        (fullText, convId) => { setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText, streaming: false } : m)); setConversationId(convId); setSending(false); scrollToBottom() },
        () => { handleSendFallback(msg, assistantMsg.id) },
      )
    } catch { handleSendFallback(msg, assistantMsg.id) }
  }

  const handleSendFallback = async (msg: string, aId: string) => {
    try {
      const res = await coachService.sendMessage(msg, conversationId)
      setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: res.message.content, streaming: false } : m))
      setConversationId(res.conversationId)
    } catch {
      setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: '抱歉，请求失败，请重试', streaming: false } : m))
    } finally { setSending(false); scrollToBottom() }
  }

  const handleNewChat = () => { setMessages([]); setConversationId(undefined) }

  const handleShowHistory = async () => {
    try { const list = await coachService.getConversations(); setConversations(list); setShowHistory(true) }
    catch { Taro.showToast({ title: '加载失败', icon: 'none' }) }
  }

  const handleLoadConversation = async (conv: CoachConversation) => {
    try {
      const res = await coachService.getMessages(conv.id)
      setMessages(res.items.map((m: CoachMessage) => ({ id: m.id, role: m.role, content: m.content })))
      setConversationId(conv.id); setShowHistory(false); scrollToBottom()
    } catch { Taro.showToast({ title: '加载失败', icon: 'none' }) }
  }

  const handleDeleteConversation = async (id: string) => {
    try { await coachService.deleteConversation(id); setConversations(prev => prev.filter(c => c.id !== id)); if (conversationId === id) handleNewChat() }
    catch { Taro.showToast({ title: '删除失败', icon: 'none' }) }
  }

  if (showHistory) {
    return (
      <View className='flex flex-col h-screen bg-gray-50'>
        <View className='flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100'>
          <Text className='text-sm text-blue-500' onClick={() => setShowHistory(false)}>← 返回</Text>
          <Text className='text-base font-semibold'>历史对话</Text>
          <View className='w-8' />
        </View>
        <ScrollView scrollY className='flex-1 p-5'>
          {conversations.length === 0 ? (
            <View className='py-20 text-center'><Text className='text-sm text-gray-400'>暂无历史对话</Text></View>
          ) : conversations.map(conv => (
            <View className='flex items-center bg-white rounded-xl p-4 mb-3' key={conv.id}>
              <View className='flex-1' onClick={() => handleLoadConversation(conv)}>
                <Text className='block text-sm font-medium'>{conv.title || '对话'}</Text>
                <Text className='block text-xs text-gray-400 mt-1'>{new Date(conv.updatedAt).toLocaleDateString()}</Text>
              </View>
              <Text className='text-xs text-red-400 px-2' onClick={() => handleDeleteConversation(conv.id)}>删除</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    )
  }

  return (
    <View className='flex flex-col h-screen bg-gray-50'>
      <View className='flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100'>
        <Text className='text-sm text-blue-500' onClick={handleNewChat}>＋ 新对话</Text>
        <Text className='text-base font-semibold'>AI 营养教练</Text>
        <Text className='text-sm' onClick={handleShowHistory}>📋</Text>
      </View>

      <ScrollView scrollY className='flex-1 px-5 py-4' scrollIntoView={scrollId.current}>
        {messages.length === 0 ? (
          <View className='py-8'>
            {greeting && (
              <View className='flex items-start bg-white rounded-2xl p-5 mb-5'>
                <Text className='text-2xl mr-3 shrink-0'>🤖</Text>
                <Text className='text-sm text-gray-600 leading-relaxed flex-1'>{greeting.greeting}</Text>
              </View>
            )}
            <Text className='block text-xs text-gray-400 mb-3'>你可以问我：</Text>
            {(greeting?.suggestions || quickQuestions).map((q, i) => (
              <View key={i} className='bg-white rounded-xl p-4 mb-2 border border-gray-100' onClick={() => handleSend(q)}>
                <Text className='text-sm text-gray-700'>{q}</Text>
              </View>
            ))}
          </View>
        ) : messages.map(msg => (
          <View key={msg.id} className={`flex mb-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && <Text className='text-xl mr-2 shrink-0 mt-1'>🤖</Text>}
            <View className={`coach-bubble px-4 py-3 text-sm leading-relaxed ${msg.role === 'user' ? 'coach-user-bubble rounded-2xl rounded-br-sm text-white' : 'bg-white rounded-2xl rounded-bl-sm text-gray-800'}`}>
              <Text className='break-words whitespace-pre-wrap'>
                {msg.content}
                {msg.streaming && <Text className='coach-cursor'>▌</Text>}
              </Text>
            </View>
          </View>
        ))}
        <View id={scrollId.current} style={{ height: '1px' }} />
      </ScrollView>

      <View className='coach-input-bar flex items-center gap-3 px-5 py-3 bg-white border-t border-gray-100'>
        <Input
          className='coach-input flex-1'
          placeholder='输入你的问题...'
          value={input}
          onInput={e => setInput(e.detail.value)}
          confirmType='send'
          onConfirm={() => handleSend()}
          disabled={sending}
        />
        <Button className='coach-send-btn shrink-0' disabled={!input.trim() && !sending} onClick={() => handleSend()} loading={sending}>
          发送
        </Button>
      </View>
    </View>
  )
}

export default CoachPage
