'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Clock, Copy, CheckCircle, RefreshCw, Calendar, Globe, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'toDate' | 'toTimestamp';

const TIMEZONES = [
  { labelKey: 'timezones.local', value: 'local' },
  { labelKey: 'timezones.utc', value: 'UTC' },
  { labelKey: 'timezones.beijing', value: 'Asia/Shanghai' },
  { labelKey: 'timezones.tokyo', value: 'Asia/Tokyo' },
  { labelKey: 'timezones.newYork', value: 'America/New_York' },
  { labelKey: 'timezones.losAngeles', value: 'America/Los_Angeles' },
  { labelKey: 'timezones.london', value: 'Europe/London' },
  { labelKey: 'timezones.paris', value: 'Europe/Paris' },
  { labelKey: 'timezones.moscow', value: 'Europe/Moscow' },
  { labelKey: 'timezones.sydney', value: 'Australia/Sydney' },
  { labelKey: 'timezones.singapore', value: 'Asia/Singapore' },
  { labelKey: 'timezones.dubai', value: 'Asia/Dubai' },
];

const QUICK_TIMESTAMPS = [
  { labelKey: 'quickDates.today', fn: () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); } },
  { labelKey: 'quickDates.tomorrow', fn: () => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(0,0,0,0); return d.getTime(); } },
  { labelKey: 'quickDates.monday', fn: () => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() || 7) + 1); d.setHours(0,0,0,0); return d.getTime(); } },
  { labelKey: 'quickDates.monthStart', fn: () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); } },
  { labelKey: 'quickDates.yearStart', fn: () => new Date(new Date().getFullYear(), 0, 1).getTime() },
  { labelKey: 'quickDates.unixEpoch', fn: () => 0 },
];

export function TimestampTool() {
  const t = useTranslations('components.timestampTool');
  const [mode, setMode] = useState<Mode>('toDate');
  const [timestamp, setTimestamp] = useState('');
  const [dateString, setDateString] = useState('');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [useSeconds, setUseSeconds] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState('local');

  // Diff calculator
  const [diffTs1, setDiffTs1] = useState('');
  const [diffTs2, setDiffTs2] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDateInTz = (ts: number, tz: string) => {
    const date = new Date(ts);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    };
    if (tz !== 'local') options.timeZone = tz;
    return date.toLocaleString(undefined, options);
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    const localOpts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    };
    return {
      iso: date.toISOString(),
      local: date.toLocaleString(undefined, localOpts),
      utc: date.toUTCString(),
      relative: getRelativeTime(ts),
      dayOfWeek: date.toLocaleDateString(undefined, { weekday: 'long' }),
      dayOfYear: Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000),
      unixSeconds: Math.floor(ts / 1000),
    };
  };

  const getRelativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    const absDiff = Math.abs(diff);
    const isFuture = diff < 0;
    const seconds = Math.floor(absDiff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    let result = '';
    if (years > 0) result = t('relativeYears', { count: years });
    else if (months > 0) result = t('relativeMonths', { count: months });
    else if (days > 0) result = t('relativeDays', { count: days });
    else if (hours > 0) result = t('relativeHours', { count: hours });
    else if (minutes > 0) result = t('relativeMinutes', { count: minutes });
    else result = t('relativeSeconds', { count: seconds });
    return isFuture ? `${result} ${t('fromNow')}` : `${result} ${t('ago')}`;
  };

  const handleTimestampChange = (value: string) => {
    setTimestamp(value);
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setUseSeconds(value.length <= 10);
    }
  };

  const convertToDate = () => {
    const num = parseInt(timestamp, 10);
    if (isNaN(num)) return null;
    const ts = useSeconds ? num * 1000 : num;
    return formatDate(ts);
  };

  const convertToTimestamp = () => {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return { ms: date.getTime(), s: Math.floor(date.getTime() / 1000) };
  };

  // Time difference
  const timeDiff = useMemo(() => {
    const t1 = parseInt(diffTs1, 10);
    const t2 = parseInt(diffTs2, 10);
    if (isNaN(t1) || isNaN(t2)) return null;
    const ms1 = diffTs1.length <= 10 ? t1 * 1000 : t1;
    const ms2 = diffTs2.length <= 10 ? t2 * 1000 : t2;
    const diffMs = Math.abs(ms2 - ms1);
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    return {
      ms: diffMs,
      seconds,
      minutes,
      hours,
      days,
      readable: `${days}${t('daysUnit')} ${hours % 24}${t('hoursUnit')} ${minutes % 60}${t('minutesUnit')} ${seconds % 60}${t('secondsUnit')}`,
    };
  }, [diffTs1, diffTs2, t]);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const setCurrentTimestamp = () => {
    setTimestamp(String(Date.now()));
    setUseSeconds(false);
  };

  const setNowDate = () => {
    setDateString(new Date().toISOString().slice(0, 16));
  };

  const currentFormatted = formatDate(currentTime);
  const dateResult = convertToDate();
  const timestampResult = convertToTimestamp();

  // Timezone display for current time
  const tzDisplay = useMemo(() => {
    return TIMEZONES.filter(tz => tz.value !== 'local').slice(0, 6).map(tz => ({
      ...tz,
      label: t(tz.labelKey),
      time: formatDateInTz(currentTime, tz.value),
    }));
  }, [currentTime, t]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {/* Current Time */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('currentTime')}</p>
              <p className="text-2xl font-mono font-bold">{currentTime}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {currentFormatted.local} · {currentFormatted.dayOfWeek} · {t('dayOfYear')} {currentFormatted.dayOfYear}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(String(currentTime))}>
                {copied === String(currentTime) ? (
                  <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {t('copyMs')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(String(Math.floor(currentTime / 1000)))}>
                {copied === String(Math.floor(currentTime / 1000)) ? (
                  <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {t('copyS')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mode Toggle */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <Button variant={mode === 'toDate' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('toDate')} className={cn(mode !== 'toDate' && 'hover:bg-background')}>
          {t('modeToDate')}
        </Button>
        <Button variant={mode === 'toTimestamp' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('toTimestamp')} className={cn(mode !== 'toTimestamp' && 'hover:bg-background')}>
          {t('modeToTimestamp')}
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {mode === 'toDate' ? (
          <>
            {/* Timestamp Input */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('inputTimestamp')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input value={timestamp} onChange={(e) => handleTimestampChange(e.target.value)} placeholder={t('inputTimestampPlaceholder')} className="font-mono" />
                  <Button variant="outline" onClick={setCurrentTimestamp}>{t('now')}</Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-2">
                    <Button variant={!useSeconds ? 'default' : 'outline'} size="sm" onClick={() => setUseSeconds(false)}>{t('milliseconds')}</Button>
                    <Button variant={useSeconds ? 'default' : 'outline'} size="sm" onClick={() => setUseSeconds(true)}>{t('seconds')}</Button>
                  </div>
                  <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
                    <SelectTrigger className="w-48">
                      <Globe className="w-3.5 h-3.5 mr-1" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{t(tz.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Quick timestamps */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TIMESTAMPS.map(({ labelKey, fn }) => (
                    <Button key={labelKey} variant="outline" size="sm" className="h-7 text-xs" onClick={() => { const ts = fn(); setTimestamp(String(ts)); setUseSeconds(false); }}>
                      {t(labelKey)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Date Result */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('conversionResult')}</CardTitle>
              </CardHeader>
              <CardContent>
                {dateResult ? (
                  <div className="space-y-3">
                    {[
                      { label: t('localTime'), value: selectedTimezone === 'local' ? dateResult.local : formatDateInTz(useSeconds ? parseInt(timestamp) * 1000 : parseInt(timestamp), selectedTimezone) },
                      { label: t('isoFormat'), value: dateResult.iso },
                      { label: t('utcFormat'), value: dateResult.utc },
                      { label: t('relativeTime'), value: dateResult.relative },
                      { label: t('weekday'), value: dateResult.dayOfWeek },
                      { label: t('dayOfYear'), value: `${dateResult.dayOfYear}` },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <Label className="w-20 shrink-0 text-muted-foreground text-sm">{item.label}</Label>
                        <Input value={item.value} readOnly className="font-mono text-sm" />
                        <Button size="icon" variant="outline" onClick={() => copyToClipboard(item.value)}>
                          {copied === item.value ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('inputTimestamp')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* Date Input */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('inputDateTime')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input type="datetime-local" value={dateString} onChange={(e) => setDateString(e.target.value)} className="font-mono" />
                  <Button variant="outline" onClick={setNowDate}>{t('now')}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('selectDate')}</p>
              </CardContent>
            </Card>

            {/* Timestamp Result */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('conversionResult')}</CardTitle>
              </CardHeader>
              <CardContent>
                {timestampResult ? (
                  <div className="space-y-3">
                    {[
                      { label: t('milliseconds'), value: String(timestampResult.ms) },
                      { label: t('seconds'), value: String(timestampResult.s) },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <Label className="w-20 shrink-0 text-muted-foreground">{item.label}</Label>
                        <Input value={item.value} readOnly className="font-mono" />
                        <Button size="icon" variant="outline" onClick={() => copyToClipboard(item.value)}>
                          {copied === item.value ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('selectDate')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Time Difference Calculator */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Minus className="w-4 h-4" />
            {t('timeDiffCalc')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">{t('timestampA')}</Label>
              <Input value={diffTs1} onChange={(e) => setDiffTs1(e.target.value)} placeholder={t('timestampPlaceholder')} className="font-mono" />
            </div>
            <div className="flex items-center justify-center pb-1">
              <span className="text-muted-foreground font-mono">-</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">{t('timestampB')}</Label>
              <Input value={diffTs2} onChange={(e) => setDiffTs2(e.target.value)} placeholder={t('timestampPlaceholder')} className="font-mono" />
            </div>
          </div>
          {timeDiff && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: t('diffDays'), value: timeDiff.days },
                { label: t('diffHours'), value: timeDiff.hours },
                { label: t('diffMinutes'), value: timeDiff.minutes },
                { label: t('diffSeconds'), value: timeDiff.seconds },
                { label: t('diffMilliseconds'), value: timeDiff.ms },
              ].map((item) => (
                <div key={item.label} className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-mono font-medium">{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
          {timeDiff && (
            <p className="text-sm text-muted-foreground text-center">
              {t('timeDiff')} {timeDiff.readable}
            </p>
          )}
        </CardContent>
      </Card>

      {/* World Clock */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {t('worldClock')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {tzDisplay.map((tz) => (
              <div
                key={tz.value}
                className="p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80 transition-colors"
                onClick={() => copyToClipboard(tz.time)}
              >
                <p className="text-xs text-muted-foreground">{tz.label}</p>
                <p className="font-mono text-sm font-medium mt-1">{tz.time}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
