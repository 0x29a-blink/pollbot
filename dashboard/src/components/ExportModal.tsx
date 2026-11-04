import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { Modal } from './ui/Modal';
import { InlineError } from './ui/primitives';
import { fmtCount, plural, toNum } from '../lib/format';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    pollTitle: string;
    fetchExport: () => Promise<{
        csv: string;
        filename: string;
        /** Rows in the CSV (one per vote). */
        total_votes: number;
        /** Distinct people who voted, when the server reports it. */
        unique_voters?: number | null;
        /** Sum of weighted votes, when the server reports it. */
        weighted_total?: number | null;
    }>;
}

const PREVIEW_ROWS = 10;

export const ExportModal: React.FC<ExportModalProps> = ({
    isOpen,
    onClose,
    pollTitle,
    fetchExport,
}) => {
    const [loading, setLoading] = useState(false);
    const [csvData, setCsvData] = useState<string | null>(null);
    const [filename, setFilename] = useState('export.csv');
    const [totalVotes, setTotalVotes] = useState(0);
    const [uniqueVoters, setUniqueVoters] = useState<number | null>(null);
    const [weightedTotal, setWeightedTotal] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const fetchExportRef = useRef(fetchExport);

    useEffect(() => {
        fetchExportRef.current = fetchExport;
    }, [fetchExport]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchExportRef.current();
                if (!cancelled) {
                    setCsvData(data.csv);
                    setFilename(data.filename);
                    setTotalVotes(data.total_votes);
                    setUniqueVoters(toNum(data.unique_voters));
                    setWeightedTotal(toNum(data.weighted_total));
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load export data');
                    setCsvData(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, reloadKey]);

    const copyToClipboard = async () => {
        if (!csvData) return;
        try {
            await navigator.clipboard.writeText(csvData);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    const downloadCsv = () => {
        if (!csvData) return;
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Parse CSV for preview (handles CRLF/LF and RFC 4180 escaped "" quotes)
    const getPreviewRows = (): string[][] => {
        if (!csvData || csvData.startsWith('No votes')) return [];
        const lines = csvData.split(/\r?\n/).filter(l => l.length > 0).slice(0, PREVIEW_ROWS + 1); // Header + 10 rows
        return lines.map(line => {
            const result: string[] = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (inQuotes && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            return result;
        });
    };

    const previewRows = getPreviewRows();
    const headers = previewRows[0] || [];
    const dataRows = previewRows.slice(1);
    const hasData = !loading && !error && !!csvData && !csvData.startsWith('No votes');
    const isEmpty = !loading && !error && !!csvData && csvData.startsWith('No votes');

    const summary = uniqueVoters !== null
        ? [
            plural(uniqueVoters, 'voter'),
            weightedTotal !== null ? `${fmtCount(weightedTotal)} weighted ${weightedTotal === 1 ? 'vote' : 'votes'}` : null,
            plural(totalVotes, 'row'),
        ].filter(Boolean).join(' · ')
        : plural(totalVotes, 'vote row');

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Export votes"
            subtitle={pollTitle}
            width="max-w-4xl"
            footerStart={hasData ? <span title={filename}>{filename}</span> : undefined}
            footer={
                hasData ? (
                    <>
                        <button type="button" onClick={copyToClipboard} className="btn btn-outline" aria-live="polite">
                            {copied ? (
                                <>
                                    <Check className="w-4 h-4 text-positive" aria-hidden="true" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="w-4 h-4" aria-hidden="true" />
                                    Copy CSV
                                </>
                            )}
                        </button>
                        <button type="button" onClick={downloadCsv} className="btn btn-primary">
                            <Download className="w-4 h-4" aria-hidden="true" />
                            Download CSV
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onClose} className="btn btn-outline">
                        Close
                    </button>
                )
            }
        >
            {loading ? (
                <div role="status" aria-label="Loading export" className="motion-safe:animate-pulse">
                    <div className="skeleton h-5 w-56 mb-4" />
                    <div className="rounded-card border border-line overflow-hidden">
                        <div className="h-9 px-3 flex items-center gap-6 border-b border-rule">
                            {[80, 120, 96, 140].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: w }} />)}
                        </div>
                        {Array.from({ length: 6 }, (_, r) => (
                            <div key={r} className="h-9 px-3 flex items-center gap-6 border-b border-rule last:border-b-0">
                                {[80, 120, 96, 140].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: w * 0.8 }} />)}
                            </div>
                        ))}
                    </div>
                </div>
            ) : error ? (
                <div className="rounded-card border border-line">
                    <InlineError message={`Couldn't load the export. ${error}`} onRetry={() => setReloadKey(k => k + 1)} />
                </div>
            ) : isEmpty ? (
                <div className="rounded-card border border-dashed border-control px-5 py-10 text-center">
                    <p className="text-sm font-semibold text-ink">No votes to export</p>
                    <p className="text-sm text-faint mt-1">The CSV will have a row for each vote once people start voting.</p>
                </div>
            ) : hasData ? (
                <>
                    <p className="text-sm text-muted mb-3 num">{summary}</p>

                    <div className="rounded-card border border-line bg-surface overflow-hidden">
                        <div className="overflow-auto max-h-[360px]">
                            <table className="w-full text-[13px] border-collapse">
                                <thead>
                                    <tr>
                                        {headers.map((header, i) => (
                                            <th
                                                key={i}
                                                scope="col"
                                                className="sticky top-0 bg-surface h-9 px-3 text-left text-xs font-normal text-faint whitespace-nowrap border-b border-rule"
                                            >
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataRows.map((row, rowIndex) => (
                                        <tr key={rowIndex} className="border-b border-rule last:border-b-0">
                                            {row.map((cell, cellIndex) => (
                                                <td
                                                    key={cellIndex}
                                                    className="h-9 px-3 text-muted whitespace-nowrap max-w-[220px] truncate num"
                                                    title={cell}
                                                >
                                                    {cell || <span className="text-faint">—</span>}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {totalVotes > PREVIEW_ROWS && (
                        <p className="text-xs text-faint mt-2 num">
                            Showing the first {PREVIEW_ROWS} of {fmtCount(totalVotes)} rows. The download has them all.
                        </p>
                    )}
                </>
            ) : null}
        </Modal>
    );
};
