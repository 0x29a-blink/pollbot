import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Download, Copy, Check, FileSpreadsheet, FileDown } from 'lucide-react';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    pollTitle: string;
    fetchExport: () => Promise<{
        csv: string;
        filename: string;
        total_votes: number;
    }>;
}

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
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadExport();
        }
    }, [isOpen]);

    const loadExport = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchExport();
            setCsvData(data.csv);
            setFilename(data.filename);
            setTotalVotes(data.total_votes);
        } catch (err: any) {
            setError(err.message || 'Failed to load export data');
            setCsvData(null);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = async () => {
        if (!csvData) return;
        await navigator.clipboard.writeText(csvData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

    // Parse CSV for preview
    const getPreviewRows = (): string[][] => {
        if (!csvData || csvData.startsWith('No votes')) return [];
        const lines = csvData.split('\n').slice(0, 11); // Header + 10 rows
        return lines.map(line => {
            // Simple CSV parsing (handles quoted fields)
            const result: string[] = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
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

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="glass-panel w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-700">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                                Export Poll Data
                            </h2>
                            <p className="text-sm text-slate-400 mt-1 truncate max-w-md">{pollTitle}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden p-5">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                            </div>
                        ) : error ? (
                            <div className="text-center py-12">
                                <p className="text-red-400">{error}</p>
                            </div>
                        ) : csvData?.startsWith('No votes') ? (
                            <div className="text-center py-12">
                                <Download className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-400">No votes to export</p>
                            </div>
                        ) : (
                            <>
                                {/* Stats */}
                                <div className="flex items-center gap-4 mb-4">
                                    <span className="text-sm text-slate-400">
                                        <span className="text-white font-bold">{totalVotes}</span> vote{totalVotes !== 1 ? 's' : ''} total
                                    </span>
                                </div>

                                {/* CSV Preview Table */}
                                <div className="border border-slate-700 rounded-lg overflow-hidden">
                                    <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-slate-800 sticky top-0">
                                                <tr>
                                                    {headers.map((header, i) => (
                                                        <th
                                                            key={i}
                                                            className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap border-b border-slate-700"
                                                        >
                                                            {header}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {dataRows.map((row, rowIndex) => (
                                                    <tr key={rowIndex} className="hover:bg-slate-800/50">
                                                        {row.map((cell, cellIndex) => (
                                                            <td
                                                                key={cellIndex}
                                                                className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-[200px] truncate"
                                                                title={cell}
                                                            >
                                                                {cell || '-'}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {totalVotes > 10 && (
                                        <div className="px-3 py-2 bg-slate-800/50 border-t border-slate-700 text-xs text-slate-500 text-center">
                                            Showing preview of first 10 rows • {totalVotes - 10} more in full export
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    {csvData && !csvData.startsWith('No votes') && (
                        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700">
                            <button
                                onClick={copyToClipboard}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${copied
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                    }`}
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        Copy to Clipboard
                                    </>
                                )}
                            </button>
                            <button
                                onClick={downloadCsv}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-500 transition-colors"
                            >
                                <FileDown className="w-4 h-4" />
                                Download CSV
                            </button>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
